console.log(
  "[Brightspace Downloader] Weblectures script active"
);

const recordingId = getRecordingId();



if (recordingId) {
  console.log(
    "[Brightspace Downloader] Recording ID:",
    recordingId
  );


  const link = generateDownloadLink(recordingId);

  console.log(
    "[Brightspace Downloader] Download link:",
    link
  );

  const data = httpGetAsync(link, async function(response) {
    const jsonResponse = JSON.parse(response);
    const downloadUrl = jsonResponse?.data?.[0]?.url;

    console.log(
      "[Brightspace Downloader] JSON response:",
      jsonResponse
    );
    const audio = jsonResponse["audio"]?.["tracks"]?.[0]?.["url"];
    console.log(
      "[Brightspace Downloader] Audio URL:",
      audio
    );

    const video_360 = jsonResponse["360p"]?.["resource"]?.["url"];
    console.log(
      "[Brightspace Downloader] Video 360 URL:",
      video_360
    );

    const video_720 = jsonResponse["720p"]?.["resource"]?.["url"];
    console.log(
      "[Brightspace Downloader] Video 720 URL:",
      video_720
    );

    const video_1080 = jsonResponse["1080p"]?.["resource"]?.["url"];
    console.log(
      "[Brightspace Downloader] Video 1080 URL:",
      video_1080
    );

    if (audio && (video_360 || video_720 || video_1080)) {
      console.log(
        "[Brightspace Downloader] Waitin for user input..."
      );

      const mediaData = {
        recordingId: recordingId,

        audioUrl: audio,

        videoUrls: {
          "360p": video_360 ?? null,
          "720p": video_720 ?? null,
          "1080p": video_1080 ?? null
        }
      };

      console.log(
        "[Brightspace Downloader] Media data:",
        mediaData
      );
      

      const storeResponse =
        await chrome.runtime.sendMessage({
          type: "MEDIA_URLS_FOUND",
          media: mediaData
        });

      if (!storeResponse?.success) {
        console.error(
          "[Brightspace Downloader] " +
          "Could not store media:",
          storeResponse?.error
        );

        return;
      }

      injectDownloadButton();
      // chrome.runtime.sendMessage({ action: "open_popup" });

    }
    // const output = await ffmpeg.readFile("lecture.mp4");

    // const blob = new Blob(
    //   [output.buffer],
    //   { type: "video/mp4" }
    // )

    // const consumer_download_link = URL.createObjectURL(blob);
  } ); 
} else {
  console.log(
    "[Brightspace Downloader] No recording ID found"
  );
}


function injectDownloadButton() {
  // Prevent duplicate buttons if script runs multiple times
  if (document.getElementById("bs-download-btn")) return;

  const btn = document.createElement("button");
  btn.id = "bs-download-btn";
  btn.innerText = "📥 Download Lecture";
  
  // Style it so it floats visibly in the iframe corner
  btn.style.position = "fixed";
  btn.style.top = "10px";
  btn.style.right = "10px";
  btn.style.zIndex = "99999";
  btn.style.padding = "10px 15px";
  btn.style.backgroundColor = "#0073e6";
  btn.style.color = "white";
  btn.style.border = "none";
  btn.style.borderRadius = "4px";
  btn.style.cursor = "pointer";
  btn.style.fontWeight = "bold";

  // NOW we have a valid User Gesture!
  btn.addEventListener("click", async () => {
  try {
    const response =
      await chrome.runtime.sendMessage({
        type: "OPEN_DOWNLOAD_POPUP"
      });

    if (!response?.success) {
      throw new Error(
        response?.error ||
        "Could not open the popup"
      );
    }
  } catch (error) {
    console.error(
      "[Brightspace Downloader]",
      error
    );
  }
});

  document.body.appendChild(btn);

}
function getRecordingId() {
  const match = window.location.pathname.match(
    /^\/permalink\/([^/]+)\/iframe\/?$/i
  );

  return match?.[1] ?? null;
}

function generateDownloadLink(recordingId) {
  return `https://weblectures.ru.nl/api/v2/medias/modes/?oid=${recordingId}&html5=webm_ogg_ogv_oga_mp4_m4a_mp3_m3u8&yt=yt&embed=embed`;
}


function httpGetAsync(theUrl, callback)
{
    var xmlHttp = new XMLHttpRequest();
    xmlHttp.onreadystatechange = function() { 
        if (xmlHttp.readyState == 4 && xmlHttp.status == 200)
            callback(xmlHttp.responseText);
    }
    xmlHttp.open("GET", theUrl, true); // true for asynchronous 
    xmlHttp.send(null);
}
