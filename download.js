const qualitySelect =
  document.getElementById("recordingSelect");

const downloadButton =
  document.getElementById("Download");

const closeButton =
  document.getElementById("cancelDownload");

const progressSection =
  document.getElementById("progressSection");

const progressBar =
  document.getElementById("progressBar");

const progressTrack =
  document.getElementById("progressTrack");

const progressText =
  document.getElementById("progressText");

const progressDetails =
  document.getElementById("progressDetails");

const statusText =
  document.getElementById("statusText");

const errorMessage =
  document.getElementById("errorMessage");


initializeQualityOptions().catch((error) => {
  console.error(
    "[Popup] Could not initialize qualities:",
    error
  );

  showError(error.message);
});


downloadButton.addEventListener(
  "click",
  async () => {
    const quality = qualitySelect.value;

    setDownloadingState();

    updateProgress(
      0,
      "Preparing download…",
      `Selected quality: ${quality}`
    );

    try {
      const response =
        await chrome.runtime.sendMessage({
          type: "START_DOWNLOAD",
          quality
        });

      if (
        !response?.success &&
        !response?.accepted
      ) {
        throw new Error(
          response?.error ||
          "The download could not be started"
        );
      }
    } catch (error) {
      showError(error.message);
    }
  }
);

closeButton.addEventListener("click", () => {
  window.close();
});

chrome.runtime.onMessage.addListener(
  (message) => {
    if (message.type !== "DOWNLOAD_PROGRESS") {
      return;
    }

    if (message.error) {
      showError(message.error);
      return;
    }

    updateProgress(
      message.percent,
      message.status,
      message.details
    );

    if (message.percent >= 100) {
      downloadButton.hidden = true;
      qualitySelect.disabled = true;

      closeButton.textContent = "Done";
    }
  }
);

async function initializeQualityOptions() {
  const { activeRecordingTabId } =
    await chrome.storage.session.get(
      "activeRecordingTabId"
    );

  if (activeRecordingTabId === undefined) {
    throw new Error(
      "No recording was selected"
    );
  }

  const storageKey =
    `recording_${activeRecordingTabId}`;

  const storedData =
    await chrome.storage.session.get(storageKey);

  const media = storedData[storageKey];

  if (!media) {
    throw new Error(
      "No recording information was found"
    );
  }

  console.log(
    "[Popup] Available video URLs:",
    media.videoUrls
  );

  const qualityOptions = {
    "360p": qualitySelect.querySelector(
      'option[value="360p"]'
    ),

    "720p": qualitySelect.querySelector(
      'option[value="720p"]'
    ),

    "1080p": qualitySelect.querySelector(
      'option[value="1080p"]'
    )
  };

  for (
    const [quality, option]
    of Object.entries(qualityOptions)
  ) {
    if (!option) {
      console.warn(
        `[Popup] No option exists for ${quality}`
      );

      continue;
    }

    const isAvailable = Boolean(
      media.videoUrls?.[quality]
    );

    option.disabled = !isAvailable;

    console.log(
      `[Popup] ${quality}:`,
      isAvailable ? "available" : "unavailable"
    );
  }

  /*
   * If the selected quality is unavailable,
   * automatically select the first available one.
   */
  const selectedOption =
    qualitySelect.selectedOptions[0];

  if (selectedOption?.disabled) {
    const firstAvailableOption = [
      ...qualitySelect.options
    ].find((option) => !option.disabled);

    if (firstAvailableOption) {
      qualitySelect.value =
        firstAvailableOption.value;
    }
  }

  const hasAvailableQuality = [
    ...qualitySelect.options
  ].some((option) => !option.disabled);

  if (!hasAvailableQuality) {
    qualitySelect.disabled = true;
    downloadButton.disabled = true;

    throw new Error(
      "This recording has no downloadable video quality"
    );
  }
}

function setDownloadingState() {
  errorMessage.hidden = true;
  progressSection.hidden = false;

  qualitySelect.disabled = true;
  downloadButton.disabled = true;
  downloadButton.textContent = "Downloading…";

  closeButton.textContent = "Hide";
}

function updateProgress(
  percent,
  status,
  details
) {
  const safePercent = Math.min(
    100,
    Math.max(0, Math.round(percent))
  );

  progressSection.hidden = false;

  progressBar.style.width =
    `${safePercent}%`;

  progressText.textContent =
    `${safePercent}%`;

  progressTrack.setAttribute(
    "aria-valuenow",
    String(safePercent)
  );

  if (status) {
    statusText.textContent = status;
  }

  if (details) {
    progressDetails.textContent = details;
  }
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = false;

  statusText.textContent = "Download failed";

  downloadButton.disabled = false;
  downloadButton.hidden = false;
  downloadButton.textContent = "Try again";

  qualitySelect.disabled = false;
  closeButton.textContent = "Close";
}