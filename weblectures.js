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

  const data = httpGetAsync(link, function(response) {
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

    
  } ); 
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
