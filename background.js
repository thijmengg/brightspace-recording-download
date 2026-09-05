const lectureDownloads = new Map();

let offscreenCreationPromise = null;

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    if (
      message.target === "background" &&
      message.type === "FFMPEG_FINISHED"
    ) {
      respondAsync(
        () => startBrowserDownload(message),
        sendResponse,
        "Starting Chrome download"
      );

      return true;
    }

    if (message.type === "MEDIA_URLS_FOUND") {
      respondAsync(
        () => storeMediaUrls(message, sender),
        sendResponse,
        "Storing recording URLs"
      );

      return true;
    }

    if (message.type === "OPEN_DOWNLOAD_POPUP") {
      respondAsync(
        () => openDownloadPopup(sender),
        sendResponse,
        "Opening download popup"
      );

      return true;
    }

    if (message.type === "START_DOWNLOAD") {
      respondAsync(
        () => startLectureProcessing(message.quality),
        sendResponse,
        "Starting lecture processing"
      );

      return true;
    }

    return false;
  }
);

chrome.downloads.onChanged.addListener((delta) => {
  const lectureDownload = lectureDownloads.get(delta.id);

  if (!lectureDownload) {
    return;
  }

  if (delta.state?.current === "complete") {
    lectureDownloads.delete(delta.id);

    releaseDownloadUrl(lectureDownload.downloadUrl);

    publishProgress({
      type: "DOWNLOAD_PROGRESS",
      percent: 100,
      status: "Download complete",
      details: `${lectureDownload.filename} was saved successfully`
    });

    return;
  }

  if (delta.state?.current === "interrupted") {
    lectureDownloads.delete(delta.id);

    releaseDownloadUrl(lectureDownload.downloadUrl);

    publishProgress({
      type: "DOWNLOAD_PROGRESS",
      error:
        delta.error?.current ||
        "The Chrome download was interrupted"
    });
  }
});

function respondAsync(task, sendResponse, description) {
  Promise.resolve()
    .then(task)
    .then((result) => {
      sendResponse(result ?? { success: true });
    })
    .catch((error) => {
      console.error(`[Background] ${description} failed:`, error);

      sendResponse({
        success: false,
        error: getErrorMessage(error)
      });
    });
}

function getErrorMessage(error) {
  return error instanceof Error
    ? error.message
    : String(error);
}

function publishProgress(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // The popup may have been closed. The download itself continues.
  });
}

function releaseDownloadUrl(downloadUrl) {
  chrome.runtime.sendMessage({
    target: "offscreen",
    type: "REVOKE_DOWNLOAD_URL",
    downloadUrl
  }).catch(() => {
    // The offscreen document may already have been closed.
  });
}

async function startBrowserDownload(message) {
  if (!message.downloadUrl) {
    throw new Error("FFmpeg did not provide a download URL");
  }

  const filename = sanitizeFilename(
    message.filename || "lecture.mp4"
  );

  const downloadId = await chrome.downloads.download({
    url: message.downloadUrl,
    filename,
    saveAs: false,
    conflictAction: "uniquify"
  });

  if (downloadId === undefined) {
    throw new Error("Chrome did not return a download ID");
  }

  lectureDownloads.set(downloadId, {
    filename,
    downloadUrl: message.downloadUrl
  });

  console.log(
    "[Background] Download started with ID:",
    downloadId
  );

  return {
    success: true,
    downloadId
  };
}

async function startLectureProcessing(quality) {
  const media = await prepareDownload(quality);

  console.log("[Background] Video URL:", media.videoUrl);
  console.log("[Background] Audio URL:", media.audioUrl);

  await ensureOffscreenDocument();

  const offscreenResponse = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "START_FFMPEG",
    videoUrl: media.videoUrl,
    audioUrl: media.audioUrl,
    filename: `${sanitizeFilename(media.recordingId || "lecture")}.mp4`
  });

  if (!offscreenResponse?.accepted) {
    throw new Error(
      offscreenResponse?.error ||
      "The offscreen document did not accept the FFmpeg job"
    );
  }

  return {
    success: true,
    started: true
  };
}

async function ensureOffscreenDocument() {
  if (offscreenCreationPromise) {
    await offscreenCreationPromise;
    return;
  }

  offscreenCreationPromise = (async () => {
    const offscreenUrl = chrome.runtime.getURL("offscreen.html");

    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl]
    });

    if (existingContexts.length > 0) {
      return;
    }

    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["BLOBS", "WORKERS"],
      justification:
        "Combine lecture video and audio using FFmpeg"
    });
  })();

  try {
    await offscreenCreationPromise;
  } finally {
    offscreenCreationPromise = null;
  }
}

async function storeMediaUrls(message, sender) {
  const tabId = sender.tab?.id;

  if (tabId === undefined) {
    throw new Error("Could not determine the Brightspace tab");
  }

  if (!message.media) {
    throw new Error("No recording media data was supplied");
  }

  const storageKey = `recording_${tabId}`;

  await chrome.storage.session.set({
    [storageKey]: message.media
  });

  return { success: true };
}

async function openDownloadPopup(sender) {
  const tabId = sender.tab?.id;

  if (tabId === undefined) {
    throw new Error("Could not determine the Brightspace tab");
  }

  await chrome.storage.session.set({
    activeRecordingTabId: tabId
  });

  await chrome.action.openPopup();

  return { success: true };
}

async function prepareDownload(quality) {
  const allowedQualities = new Set([
    "360p",
    "720p",
    "1080p"
  ]);

  if (!allowedQualities.has(quality)) {
    throw new Error(`Unsupported quality: ${quality}`);
  }

  const { activeRecordingTabId } =
    await chrome.storage.session.get(
      "activeRecordingTabId"
    );

  if (activeRecordingTabId === undefined) {
    throw new Error("No active recording was selected");
  }

  const storageKey = `recording_${activeRecordingTabId}`;
  const storedData = await chrome.storage.session.get(storageKey);
  const media = storedData[storageKey];

  if (!media) {
    throw new Error("No recording URLs were stored");
  }

  const videoUrl = media.videoUrls?.[quality];
  const audioUrl = media.audioUrl;

  if (!videoUrl) {
    throw new Error(
      `${quality} is unavailable for this recording`
    );
  }

  if (!audioUrl) {
    throw new Error("No audio stream is available");
  }

  return {
    recordingId: media.recordingId || "lecture",
    videoUrl,
    audioUrl
  };
}

function sanitizeFilename(value) {
  const sanitized = String(value)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();

  return sanitized || "lecture";
}
