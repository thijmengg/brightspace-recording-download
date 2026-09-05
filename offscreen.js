const { FFmpeg } = FFmpegWASM;

let ffmpegInstance = null;
let ffmpegLoadPromise = null;
let isProcessing = false;
let mergeInProgress = false;

function reportProgress(percent, status, details = "") {
  const numericPercent = Number(percent);
  const safePercent = Number.isFinite(numericPercent)
    ? Math.min(100, Math.max(0, Math.round(numericPercent)))
    : 0;

  chrome.runtime.sendMessage({
    type: "DOWNLOAD_PROGRESS",
    percent: safePercent,
    status,
    details
  }).catch(() => {
    // The action popup may have been closed. Processing should continue.
  });
}

function reportError(error) {
  const message = error instanceof Error
    ? error.message
    : String(error);

  chrome.runtime.sendMessage({
    type: "DOWNLOAD_PROGRESS",
    error: message
  }).catch(() => {
    // The action popup may have been closed.
  });
}

async function getFFmpeg() {
  if (!ffmpegInstance) {
    ffmpegInstance = new FFmpeg();

    ffmpegInstance.on("log", ({ message }) => {
      console.log("[FFmpeg]", message);
    });

    ffmpegInstance.on("progress", ({ progress }) => {
      const percentage = Math.round(progress * 100);
      console.log(`[FFmpeg] ${percentage}%`);

      if (mergeInProgress) {
        reportProgress(
          70 + progress * 25,
          "Combining video and audio…",
          `Creating MP4: ${percentage}%`
        );
      }
    });
  }

  if (!ffmpegLoadPromise) {
    console.log("[FFmpeg] Loading core");

    ffmpegLoadPromise = ffmpegInstance.load({
      coreURL: chrome.runtime.getURL(
        "vendor/core/ffmpeg-core.js"
      ),
      wasmURL: chrome.runtime.getURL(
        "vendor/core/ffmpeg-core.wasm"
      )
    }).then(() => {
      console.log("[FFmpeg] Core loaded");
    }).catch((error) => {
      try {
        ffmpegInstance?.terminate();
      } catch {
        // Ignore cleanup errors after a failed load.
      }

      ffmpegInstance = null;
      ffmpegLoadPromise = null;
      throw error;
    });
  }

  await ffmpegLoadPromise;
  return ffmpegInstance;
}

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    if (
      message.target === "offscreen" &&
      message.type === "REVOKE_DOWNLOAD_URL"
    ) {
      if (message.downloadUrl) {
        URL.revokeObjectURL(message.downloadUrl);
      }

      sendResponse({ success: true });
      return;
    }

    if (
      message.target !== "offscreen" ||
      message.type !== "START_FFMPEG"
    ) {
      return;
    }

    if (isProcessing) {
      sendResponse({
        accepted: false,
        error: "Another lecture is already being processed"
      });
      return;
    }

    isProcessing = true;

    // This response is synchronous: the background worker only needs to know
    // that the offscreen document accepted the job.
    sendResponse({ accepted: true });

    processLecture(message)
      .catch((error) => {
        console.error("FFmpeg failed:", error);
        reportError(error);
      })
      .finally(() => {
        isProcessing = false;
        mergeInProgress = false;
      });
  }
);

async function processLecture(message) {
  const { videoUrl, audioUrl, filename } = message;

  if (!videoUrl) {
    throw new Error("No video playlist URL was supplied");
  }

  if (!audioUrl) {
    throw new Error("No audio playlist URL was supplied");
  }

  reportProgress(
    1,
    "Loading video processor…",
    "Starting FFmpeg"
  );

  const ffmpeg = await getFFmpeg();
  const taskId = Date.now().toString(36);
  const outputFilename = `lecture_${taskId}.mp4`;
  const createdInputFiles = [];

  try {
    console.log("[FFmpeg] Downloading HLS inputs");

    const video = await localizeHlsPlaylist(
      ffmpeg,
      videoUrl,
      `video_${taskId}`,
      (completed, total) => {
        const ratio = total > 0 ? completed / total : 1;

        reportProgress(
          2 + ratio * 53,
          "Downloading video…",
          `${completed} of ${total} video files`
        );
      }
    );

    createdInputFiles.push(...video.files);

    const audio = await localizeHlsPlaylist(
      ffmpeg,
      audioUrl,
      `audio_${taskId}`,
      (completed, total) => {
        const ratio = total > 0 ? completed / total : 1;

        reportProgress(
          55 + ratio * 15,
          "Downloading audio…",
          `${completed} of ${total} audio files`
        );
      }
    );

    createdInputFiles.push(...audio.files);

    console.log("[FFmpeg] Combining streams");
    reportProgress(
      70,
      "Combining video and audio…",
      "Creating the final MP4 file"
    );

    mergeInProgress = true;

    const exitCode = await ffmpeg.exec([
      "-y",
      "-protocol_whitelist",
      "file,crypto,data",
      "-allowed_extensions",
      "ALL",
      "-i",
      video.playlist,
      "-i",
      audio.playlist,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      outputFilename
    ]);

    mergeInProgress = false;

    if (exitCode !== 0) {
      throw new Error(`FFmpeg exited with code ${exitCode}`);
    }

    console.log("[FFmpeg] Reading result");
    reportProgress(
      96,
      "Finalizing MP4…",
      "Preparing the file for Chrome"
    );

    const output = await ffmpeg.readFile(outputFilename);
    const blob = new Blob([output], { type: "video/mp4" });
    const downloadUrl = URL.createObjectURL(blob);

    const result = await chrome.runtime.sendMessage({
      target: "background",
      type: "FFMPEG_FINISHED",
      downloadUrl,
      filename: filename || "lecture.mp4"
    });

    if (!result?.success) {
      URL.revokeObjectURL(downloadUrl);

      throw new Error(
        result?.error || "Chrome could not start the download"
      );
    }

    reportProgress(
      99,
      "Saving file…",
      "Chrome is writing the MP4 to disk"
    );

    console.log("[FFmpeg] Download started");
  } finally {
    mergeInProgress = false;

    await deleteFiles(ffmpeg, createdInputFiles);
    await deleteFiles(ffmpeg, [outputFilename]);
  }
}

async function fetchChecked(url) {
  const parsedUrl = new URL(url);

  if (parsedUrl.protocol !== "https:") {
    throw new Error(
      `Unsupported resource protocol: ${parsedUrl.protocol}`
    );
  }

  const response = await fetch(parsedUrl.href, {
    credentials: "include"
  });

  if (!response.ok) {
    throw new Error(
      `Could not fetch ${parsedUrl.href}: HTTP ${response.status}`
    );
  }

  return response;
}

function getFileExtension(url) {
  const pathname = new URL(url).pathname;
  const match = pathname.match(/(\.[a-zA-Z0-9]{1,10})$/);

  return match?.[1] ?? ".bin";
}

function resolveResourceUrl(reference, playlistUrl) {
  const resolvedUrl = new URL(reference, playlistUrl);

  if (resolvedUrl.protocol !== "https:") {
    throw new Error(
      `Unsupported HLS resource protocol: ${resolvedUrl.protocol}`
    );
  }

  return resolvedUrl.href;
}

function collectResourceUrls(lines, playlistUrl) {
  const resourceUrls = new Set();

  for (const originalLine of lines) {
    const trimmedLine = originalLine.trim();

    if (trimmedLine && !trimmedLine.startsWith("#")) {
      resourceUrls.add(
        resolveResourceUrl(trimmedLine, playlistUrl)
      );
    }

    const uriPattern = /URI="([^"]+)"/g;
    let uriMatch;

    while ((uriMatch = uriPattern.exec(originalLine)) !== null) {
      resourceUrls.add(
        resolveResourceUrl(uriMatch[1], playlistUrl)
      );
    }
  }

  return resourceUrls;
}

async function localizeHlsPlaylist(
  ffmpeg,
  playlistUrl,
  prefix,
  onProgress = () => {}
) {
  console.log(`[HLS] Downloading ${prefix} playlist`);

  const createdFiles = [];

  try {
    const playlistResponse = await fetchChecked(playlistUrl);
    const playlistText = await playlistResponse.text();

    if (!playlistText.trimStart().startsWith("#EXTM3U")) {
      throw new Error(`${prefix} is not a valid HLS playlist`);
    }

    const lines = playlistText.split(/\r?\n/);
    const totalResources = collectResourceUrls(
      lines,
      playlistUrl
    ).size;

    const rewrittenLines = [];
    const downloadedResources = new Map();

    let resourceNumber = 0;
    let completedResources = 0;

    onProgress(0, totalResources);

    async function downloadResource(reference) {
      const absoluteUrl = resolveResourceUrl(
        reference,
        playlistUrl
      );

      if (downloadedResources.has(absoluteUrl)) {
        return downloadedResources.get(absoluteUrl);
      }

      if (
        new URL(absoluteUrl).pathname
          .toLowerCase()
          .endsWith(".m3u8")
      ) {
        throw new Error(
          "A nested/master playlist was found. " +
          "Recursive playlist support must be added."
        );
      }

      const extension = getFileExtension(absoluteUrl);
      const localFilename =
        `${prefix}_${resourceNumber}${extension}`;

      resourceNumber += 1;

      console.log(`[HLS] Downloading ${localFilename}`);

      const response = await fetchChecked(absoluteUrl);
      const data = new Uint8Array(
        await response.arrayBuffer()
      );

      await ffmpeg.writeFile(localFilename, data);

      downloadedResources.set(absoluteUrl, localFilename);
      createdFiles.push(localFilename);
      completedResources += 1;

      onProgress(completedResources, totalResources);

      return localFilename;
    }

    for (const originalLine of lines) {
      const trimmedLine = originalLine.trim();

      if (trimmedLine === "") {
        rewrittenLines.push("");
        continue;
      }

      if (!trimmedLine.startsWith("#")) {
        const localFilename = await downloadResource(trimmedLine);
        rewrittenLines.push(localFilename);
        continue;
      }

      const uriMatch = originalLine.match(/URI="([^"]+)"/);

      if (uriMatch) {
        const originalUri = uriMatch[1];
        const localFilename = await downloadResource(originalUri);
        const rewrittenLine = originalLine.replace(
          `URI="${originalUri}"`,
          `URI="${localFilename}"`
        );

        rewrittenLines.push(rewrittenLine);
        continue;
      }

      rewrittenLines.push(originalLine);
    }

    const localPlaylist = `${prefix}.m3u8`;

    await ffmpeg.writeFile(
      localPlaylist,
      new TextEncoder().encode(rewrittenLines.join("\n"))
    );

    createdFiles.push(localPlaylist);

    console.log(
      `[HLS] Stored ${completedResources} ${prefix} resources`
    );

    return {
      playlist: localPlaylist,
      files: createdFiles
    };
  } catch (error) {
    await deleteFiles(ffmpeg, createdFiles);
    throw error;
  }
}

async function deleteFiles(ffmpeg, filenames) {
  for (const filename of filenames) {
    try {
      await ffmpeg.deleteFile(filename);
    } catch {
      // Ignore missing files and cleanup failures.
    }
  }
}
