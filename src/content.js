let interval;
let element;
let incidentCount = -1; // Initialize to -1 to ensure first fetch sets it
let lastKnownActionDate = null;
let alertAudio;
let intervalSelection;

chrome.runtime.sendMessage({ event: "pageRefreshed" });

if (
  window.location.href.includes(
    "https://support.wmed.edu/LiveTime/WebObjects/LiveTime.woa/wa/"
  )
) {
  document.querySelectorAll("zsd-requestalert").forEach((e) => {
    e.style.borderRadius = "16px";
  });

  const style = document.createElement("style");
  style.textContent = `
    #editRequest > div.card.request-subject.common-subject-description-card.ml-0 > div {
        background-color: #c2d9ff !important;
    }
  `;
  document.head.appendChild(style);
}

element = document.querySelector(
  "#rightpanel > zsd-user-requestlist > div.row.rowoverride > div.mb-3.col-10 > ul > li:nth-child(2) > span"
);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.event === "initializeAudio") {
    if (!alertAudio) {
      alertAudio = new Audio(chrome.runtime.getURL("fearstofathom.mp3"));
      alertAudio.volume = 0;
      alertAudio
        .play()
        .then(() => {
          alertAudio.pause();
          alertAudio.currentTime = 0;
          alertAudio.volume = 1;
        })
        .catch((e) => console.warn("Audio pre warm failed:", e));
    }
  }
});

async function fetchIncidentData() {
  const response = await fetch(
    "https://support.wmed.edu/LiveTime/services/v1/user/requests/search?currentPage=incident&offset=0&limit=40&sortBy=requestNumber&sortOrder=DESC&filterId=176&locale=en-GB",
    {
      headers: {
        accept: "application/json, text/plain, */*",
        "accept-language": "en-GB,en;q=0.7",
        "content-type": "application/json",
        "sec-ch-ua": '"Brave";v="135", "Not-A.Brand";v="8", "Chromium";v="135"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "sec-gpc": "1",
        "zsd-source": "LT",
      },
      referrer: "https://support.wmed.edu/LiveTime/WebObjects/LiveTime",
      referrerPolicy: "strict-origin-when-cross-origin",
      body: '{"requestAdditionalSearchInfo":{},"searchTerm":null,"requestFilterInfo":null}',
      method: "POST",
      mode: "cors",
      credentials: "include",
    }
  );

  if (!response.ok) {
    throw new Error(`Network response was not ok: ${response.statusText}`);
  }

  const data = await response.json();
  if (
    !data ||
    typeof data.resultCount === "undefined" ||
    !Array.isArray(data.results)
  ) {
    throw new Error("Invalid API response structure.");
  }
  return data;
}

async function initializeMonitoringData() {
  try {
    const data = await fetchIncidentData();
    incidentCount = data.resultCount;
    console.log(`Initial incident count: ${incidentCount}`);

    if (data.results && data.results.length > 0) {
      const latestIncident = data.results[0];
      const lastActionDateValue = latestIncident.values.find(
        (v) => v.columnName === "lastActionDate"
      );
      if (lastActionDateValue && lastActionDateValue.value) {
        lastKnownActionDate = new Date(lastActionDateValue.value);
        console.log(
          `Initial last action date: ${lastKnownActionDate.toLocaleString()}`
        );
      }
    }
  } catch (error) {
    console.error("Error during initial fetch for incident data:", error);
    // Don't start interval if initial fetch fails significantly
    throw error;
  }
}

async function startMonitoring() {
  if (interval) {
    console.log("Monitoring already started.");
    return;
  }

  document.title = "👁 Service Manager";

  try {
    await initializeMonitoringData(); // Ensure initial data is set before starting interval
  } catch (error) {
    console.error(
      "Failed to initialize monitoring data. Not starting interval."
    );
    return;
  }

  interval = setInterval(async () => {
    try {
      const data = await fetchIncidentData();
      const newIncidentCount = data.resultCount;
      console.log(`Current fetched incident count: ${newIncidentCount}`);

      let isNewActivity = false;
      let changeType = "";
      let subject = "Subject not found";
      let requestNum = "N/A";

      if (newIncidentCount > incidentCount) {
        // --- Case 1: A brand new ticket has arrived ---
        isNewActivity = true;
        changeType = "new ticket";
        console.log("Detected: New ticket");

        if (data.results && data.results.length > 0) {
          const latestIncident = data.results[0]; // The very first item should be the newest by sort order
          const subjectValue = latestIncident.values.find(
            (v) => v.columnName === "subject"
          );
          if (subjectValue) subject = subjectValue.value;

          const requestNumValue = latestIncident.values.find(
            (v) => v.columnName === "requestNumber"
          );
          if (requestNumValue) requestNum = requestNumValue.value;

          const lastActionDateValue = latestIncident.values.find(
            (v) => v.columnName === "lastActionDate"
          );
          if (lastActionDateValue && lastActionDateValue.value) {
            lastKnownActionDate = new Date(lastActionDateValue.value); // Update lastKnownActionDate with the newest ticket's date
          }
        }
      } else if (data.results && data.results.length > 0) {
        // --- Case 2: No new ticket count, check for updates to existing tickets ---
        const currentLatestIncident = data.results[0];
        const currentLastActionDateValue = currentLatestIncident.values.find(
          (v) => v.columnName === "lastActionDate"
        );

        if (currentLastActionDateValue && currentLastActionDateValue.value) {
          const currentLastActionDate = new Date(
            currentLastActionDateValue.value
          );

          // Check if currentLastActionDate is strictly greater than the last known
          if (
            lastKnownActionDate &&
            currentLastActionDate.getTime() > lastKnownActionDate.getTime()
          ) {
            isNewActivity = true;
            changeType = "update to an existing ticket";
            console.log("Detected: Update to existing ticket");

            const subjectValue = currentLatestIncident.values.find(
              (v) => v.columnName === "subject"
            );
            if (subjectValue) subject = subjectValue.value;

            const requestNumValue = currentLatestIncident.values.find(
              (v) => v.columnName === "requestNumber"
            );
            if (requestNumValue) requestNum = requestNumValue.value;

            lastKnownActionDate = currentLastActionDate; // Update lastKnownActionDate
          }
        }
      }

      // Update incidentCount regardless of activity detection for the next cycle
      incidentCount = newIncidentCount;

      if (isNewActivity) {
        document.title = "📣 Service Manager";
        Swal.fire({
          color: "#fff",
          title: `A ${changeType} just landed!`,
          icon: "warning",
          iconColor: "#4ddfd4",
          background: "#282a2b",
          text: `Subject - ${subject}`,
          confirmButtonText: "Take me there!",
          confirmButtonColor: "#07ada1",
          showCancelButton: true,
          cancelButtonText: "Close",
          reverseButtons: true,
          theme: "auto",
          padding: "0 0 2.5rem",
        }).then((result) => {
          document.title = "👁 Service Manager";

          if (result.isConfirmed) {
            window.open(
              `https://support.wmed.edu/LiveTime/WebObjects/LiveTime.woa/wa/LookupRequest?sourceId=New&requestId=${requestNum}`
            );
          }
          const refreshIcon = document.querySelector(
            "#requestfiltercard > div.card-body.pt-0 > zsd-requestfilter > div.main-filter-wrapper > div.tabheader > span.reseticon"
          );
          if (refreshIcon) refreshIcon.click();
        });

        if (alertAudio) {
          alertAudio
            .play()
            .catch((err) => console.warn("Audio play blocked:", err));
        }
      } else {
        console.log("No new activity detected.");
      }
    } catch (error) {
      console.error("Error during interval fetch:", error);
    }
  }, intervalSelection);
}

function stopMonitoring() {
  if (interval) {
    clearInterval(interval);
    interval = null;
    document.title = "Service Manager";
    lastKnownActionDate = null;
    incidentCount = -1; // Reset incident count as well
    console.log("Monitoring stopped. State reset.");
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "startMonitoring") {
    chrome.storage.local.get(["intervalTime"], (result) => {
      intervalSelection = result.intervalTime * 60000;
      if (result.intervalTime === "0" || !result.intervalTime) {
        intervalSelection = 60000; // Default to 1 minute if 0 or not set
      }
      console.log(
        `Monitoring interval set to: ${intervalSelection / 1000} seconds.`
      );
      startMonitoring();
    });
  } else if (request.action === "stopMonitoring") {
    stopMonitoring();
  }
});

window.startMonitoring = startMonitoring;
window.stopMonitoring = stopMonitoring;
