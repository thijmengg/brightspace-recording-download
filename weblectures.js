console.log(
  "[Brightspace Downloader] Weblectures script active"
);

const recordingId = getRecordingId();

if (recordingId) {
  console.log(
    "[Brightspace Downloader] Recording ID:",
    recordingId
  );
} else {
  console.log(
    "[Brightspace Downloader] No recording ID found"
  );
}

function getRecordingId() {
  const match = window.location.pathname.match(
    /^\/permalink\/([^/]+)\/iframe\/?$/i
  );

  return match?.[1] ?? null;
}