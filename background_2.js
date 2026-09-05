const lectureDownloads = new Set();

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    if (message.target == "background" && message.type === "FFMPEG_FINISHED") {
      // Handle FFMPEG finished message
      chrome.downloads.download({
        url: message.downloadUrl,
        filename: message.filename || "lecture.mp4",
        saveAs: false,
        conflictAction: "uniquify"
    }).then((downloadId) => {
        console.log("[Background] Download started with ID:", downloadId);
        sendResponse({
            success: true,
            downloadId: downloadId
        });
    })
    .catch((error) => {
        console.error("[Background] Download failed:", error)
        sendResponse({
            success: false,
            error: error.message
        })
        });
    return true; // Indicate that we will send a response asynchronously
    }
    if (message.type === "MEDIA_URLS_FOUND") {
      storeMediaUrls(message, sender, sendResponse);
      return true;
    }

    if (message.type === "OPEN_DOWNLOAD_POPUP") {
      openDownloadPopup(sender, sendResponse);
      return true;
    }

    if (message.type === "START_DOWNLOAD") {
        (async () => {
            const media = await prepareDownload(message.quality);

            console.log("Video URL:", media.videoUrl);
            console.log("Audio URL:", media.audioUrl);

            await ensureOffscreenDocument();

            await chrome.runtime.sendMessage({
            target: "offscreen",
            type: "START_FFMPEG",
            videoUrl: media.videoUrl,
            audioUrl: media.audioUrl,
            filename: `${media.recordingId}.mp4`
            });

            sendResponse({
            success: true,
            started: true
            });
        })().catch((error) => {
            sendResponse({
            success: false,
            error: error.message
            });
        });

        return true;
        }
  }
);

async function ensureOffscreenDocument() {
  const offscreenUrl =
    chrome.runtime.getURL("offscreen.html");

  const existingContexts =
    await chrome.runtime.getContexts({
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
}

async function storeMediaUrls(message, sender, sendResponse) {
  const tabId = sender.tab?.id;

  if (tabId === undefined) {
    sendResponse({
      success: false,
      error: "Could not determine the Brightspace tab"
    });

    return;
  }

  const storageKey = `recording_${tabId}`;

  await chrome.storage.session.set({
    [storageKey]: message.media
  });

  sendResponse({
    success: true
  });
}

async function openDownloadPopup(sender, sendResponse) {
  const tabId = sender.tab?.id;

  if (tabId === undefined) {
    sendResponse({
      success: false,
      error: "Could not determine the Brightspace tab"
    });

    return;
  }

  await chrome.storage.session.set({
    activeRecordingTabId: tabId
  });

  await chrome.action.openPopup();

  sendResponse({
    success: true
  });
}

async function prepareDownload(quality) {
  const { activeRecordingTabId } =
    await chrome.storage.session.get(
      "activeRecordingTabId"
    );

  if (activeRecordingTabId === undefined) {
    throw new Error("No active recording was selected");
  }

  const storageKey =
    `recording_${activeRecordingTabId}`;

  const storedData =
    await chrome.storage.session.get(storageKey);

  const media = storedData[storageKey];

  if (!media) {
    throw new Error("No recording URLs were stored");
  }

  const videoUrl = media.videoUrls[quality];
  const audioUrl = media.audioUrl;

  if (!videoUrl) {
    throw new Error(
      `${quality} is unavailable for this recording`
    );
  }

  if (!audioUrl) {
    throw new Error(
      "No audio stream is available"
    );
  }

  return {
    recordingId: media.recordingId,
    videoUrl,
    audioUrl
  };
}