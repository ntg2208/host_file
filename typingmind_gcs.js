// Replace AWS SDK with Google Cloud Storage SDK (Conceptual)
// Assumes you've installed @google-cloud/storage
// const AWS = require('aws-sdk'); // Remove this
const { Storage } = require('@google-cloud/storage');

// Updated Configuration Settings
let config = {
  syncMode: "disabled",
  syncInterval: 15,
  projectId: "",          // Add Google Cloud Project ID
  bucketName: "",        // GCS Bucket Name
  keyFilename: "",       // Path to Service Account Key File
  encryptionKey: "",
};

function loadConfiguration() {
  if (!config) {
    config = {
      syncMode: "disabled",
      syncInterval: 15,
      projectId: "",
      bucketName: "",
      keyFilename: "",
      encryptionKey: "",
    };
  }
  const urlParams = new URLSearchParams(window.location.search);
  const urlSyncMode = urlParams.get("syncMode");
  if (urlSyncMode && ["disabled", "backup", "sync"].includes(urlSyncMode)) {
    localStorage.setItem("sync-mode", urlSyncMode);
    logToConsole("info", `Sync mode set from URL parameter: ${urlSyncMode}`);
    urlParams.delete("syncMode");
    const newUrl =
      window.location.pathname +
      (urlParams.toString() ? `?${urlParams.toString()}` : "") +
      window.location.hash;
    window.history.replaceState({}, "", newUrl);
  }
  const storedConfig = {
    bucketName: localStorage.getItem("gcs-bucket"),
    projectId: localStorage.getItem("gcs-project-id"),
    keyFilename: localStorage.getItem("gcs-key-filename"),
    syncInterval: parseInt(localStorage.getItem("backup-interval")) || 15,
    encryptionKey: localStorage.getItem("encryption-key"),
    syncMode: localStorage.getItem("sync-mode") || "disabled",
  };
  config = { ...config, ...storedConfig };
  config.syncMode = localStorage.getItem("sync-mode") || "disabled";
  return config;
}

function saveConfiguration() {
  localStorage.setItem("gcs-bucket", config.bucketName);
  localStorage.setItem("gcs-project-id", config.projectId);
  localStorage.setItem("gcs-key-filename", config.keyFilename);
  localStorage.setItem("backup-interval", config.syncInterval.toString());
  localStorage.setItem("encryption-key", config.encryptionKey);
  localStorage.setItem("sync-mode", config.syncMode);
}

function isGcsConfigured() {
  return !!(
    config.projectId &&
    config.keyFilename &&
    config.bucketName
  );
}

// Initialize GCS Client (Singleton)
let gcsClient;

function initializeGCSClient() {
  if (!config.projectId || !config.keyFilename || !config.bucketName) {
    throw new Error("GCS configuration is incomplete");
  }

  try {
    if (!gcsClient) {
      gcsClient = new Storage({
        projectId: config.projectId,
        keyFilename: config.keyFilename,
      });
    }
    return gcsClient;
  } catch (error) {
    console.error("Error initializing GCS client:", error);
    throw error;
  }
}

async function uploadToGCS(key, data, metadata) {
  try {
    const gcs = initializeGCSClient();
    const bucket = gcs.bucket(config.bucketName);

    let contentType = "application/octet-stream";
    if (key.endsWith(".json")) {
      contentType = "application/json";
    } else if (key.endsWith(".zip")) {
      contentType = "application/zip";
    }

    const options = {
      destination: key,
      metadata: {
        metadata: metadata, // GCS uses a nested metadata object
        contentType: contentType
      },
    };
      await bucket.upload(data,options);

    logToConsole("success", `Successfully uploaded to GCS: ${key}`);

  } catch (error) {
    logToConsole("error", `Failed to upload to GCS: ${key}`, error);
    throw error;
  }
}

async function downloadFromGCS(key) {
    try {
        const gcs = initializeGCSClient();
        const bucket = gcs.bucket(config.bucketName);
        const file = bucket.file(key);

        const [data] = await file.download();
        const [metadata] = await file.getMetadata();

        const cleanMetadata = {};
        for (const [key, value] of Object.entries(metadata.metadata || {})) {
            const cleanKey = key.replace("x-goog-meta-", "");
            cleanMetadata[cleanKey] = value;
        }

        return {
            data: data,
            metadata: cleanMetadata,
        };
    } catch (error) {
        if (error.code === 404) {
            logToConsole("info", `Object not found in GCS: ${key}`);
            return null;
        }
        logToConsole("error", `Failed to download from GCS: ${key}`, error);
        throw error;
    }
}

async function deleteFromGCS(key) {
  try {
    const gcs = initializeGCSClient();
    const bucket = gcs.bucket(config.bucketName);
    const file = bucket.file(key);

    await file.delete();
    logToConsole("success", `Successfully deleted from GCS: ${key}`);
  } catch (error) {
    logToConsole("error", `Failed to delete from GCS: ${key}`, error);
    throw error;
  }
}

async function listGCSObjects(prefix = "") {
    const gcs = initializeGCSClient();
    const bucket = gcs.bucket(config.bucketName);

    try {
        const [files] = await bucket.getFiles({ prefix: prefix });

        const objectsWithMetadata = await Promise.all(
            files.map(async (file) => {
                try {
                    const [metadata] = await file.getMetadata();
                    return {
                        Key: file.name,
                        Size: metadata.size,
                        LastModified: metadata.updated,
                        metadata: metadata.metadata || {},
                    };
                } catch (error) {
                    logToConsole("error", `Failed to get metadata for ${file.name}:`, error);
                    return {
                        Key: file.name,
                        Size: 0,
                        LastModified: null,
                        metadata: {},
                    };
                }
            })
        );

        return objectsWithMetadata;
    } catch (error) {
        logToConsole("error", "Failed to list GCS objects:", error);
        throw error;
    }
}

//Replace multipart uploads. GCS doesn't require the same type of multipart uploads as AWS S3

//Modify the openSyncModal function
function openSyncModal() {
  if (document.querySelector(".cloud-sync-modal")) {
    logToConsole("skip", "Modal already open - skipping");
    return;
  }
  logToConsole("start", "Opening sync modal...");
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const modal = document.createElement("div");
  modal.className = "cloud-sync-modal";
  modal.innerHTML = `
    <div class="text-gray-800 dark:text-white text-left text-sm">
      <div class="flex justify-center items-center mb-3">
        <h3 class="text-center text-xl font-bold">GCS Backup & Sync Settings</h3>
        <button class="ml-2 text-blue-600 text-lg hint--bottom-left hint--rounded hint--large" 
          aria-label="Fill form & Save. If you are using Google Cloud Storage - fill in Project ID, Bucket Name, and Path to Service Account Key File&#10;&#10;Initial backup: You will need to click on Export to create your first backup in GCS. Thereafter, automatic backups are done to GCS as per Backup Interval if the browser tab is active.&#10;&#10;Restore backup: If GCS already has an existing backup, this extension will automatically pick it and restore the local data.&#10;&#10;&#10;&#10;Snapshot: Creates an instant no-touch backup that will not be overwritten.&#10;&#10;Download: You can select the backup data to be downloaded and click on Download button to download it for local storage.&#10;&#10;Restore: Select the backup you want to restore and Click on Restore. The TypingMind data will be restored to the selected backup data/date.">ⓘ</button>
      </div>
      <div class="space-y-3">
        <div class="mt-4 bg-gray-100 dark:bg-zinc-800 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600">
          <div class="flex items-center justify-between mb-1">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-400">Available Backups</label>
          </div>
          <div class="space-y-2">
            <div class="w-full">
              <select id="backup-files" class="w-full px-2 py-1.5 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-zinc-700">
                <option value="">Please configure Google Cloud Storage credentials first</option>
              </select>
            </div>
            <div class="flex justify-end space-x-2">
              <button id="download-backup-btn" class="z-1 px-2 py-1.5 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed" disabled>
                Download
              </button>
              <button id="restore-backup-btn" class="z-1 px-2 py-1.5 text-sm text-white bg-green-600 rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed" disabled>
                Restore
              </button>
              <button id="delete-backup-btn" class="z-1 px-2 py-1.5 text-sm text-white bg-red-600 rounded-md hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed" disabled>
                Delete
              </button>
            </div>
          </div>
        </div>
        <div class="mt-4 bg-gray-100 dark:bg-zinc-800 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600">
          <div class="space-y-2">
            <div class="flex items-center space-x-4 mb-4">
              <label class="text-sm font-medium text-gray-700 dark:text-gray-400">Mode:</label>
              <label class="inline-flex items-center">
                <input type="radio" name="sync-mode" value="sync" class="form-radio text-blue-600" ${
                  config.syncMode === "sync" ? "checked" : ""
                }>
                <span class="ml-2">Sync</span>
                <button class="ml-1 text-blue-600 text-lg hint--top-right hint--rounded hint--medium" aria-label="Automatically syncs data between devices. When enabled, data will be imported from cloud on app start.">ⓘ</button>
              </label>
              <label class="inline-flex items-center">
                <input type="radio" name="sync-mode" value="backup" class="form-radio text-blue-600" ${
                  config.syncMode === "backup" ? "checked" : ""
                }>
                <span class="ml-2">Backup</span>
                <button class="ml-1 text-blue-600 text-lg hint--top-left hint--rounded hint--medium" aria-label="Only creates backups. No automatic import from cloud on app start.">ⓘ</button>
              </label>
              <label class="inline-flex items-center">
                <input type="radio" name="sync-mode" value="disabled" class="form-radio text-blue-600" ${
                  config.syncMode === "disabled" ? "checked" : ""
                }>
                <span class="ml-2">Disabled</span>
                <button class="ml-1 text-blue-600 text-lg hint--top-left hint--rounded hint--medium" aria-label="No automatic operations. Manual sync and snapshot operations still work.">ⓘ</button>
              </label>
            </div>
            <div class="form-group">
              <label for="gcs-project-id" class="block text-sm font-medium text-gray-700 dark:text-gray-400">Project ID <span class="text-red-500">*</span></label>
              <input type="text" id="gcs-project-id" name="gcs-project-id" value="${config.projectId || ''}" class="z-1 w-full px-2 py-1.5 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-zinc-700" autocomplete="off" required>
            </div>
            <div class="form-group">
              <label for="gcs-bucket" class="block text-sm font-medium text-gray-700 dark:text-gray-400">Bucket Name <span class="text-red-500">*</span></label>
              <input type="text" id="gcs-bucket" name="gcs-bucket" value="${config.bucketName || ''}" class="z-1 w-full px-2 py-1.5 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-zinc-700" autocomplete="off" required>
            </div>
            <div class="form-group">
              <label for="gcs-key-filename" class="block text-sm font-medium text-gray-700 dark:text-gray-400">Service Account Key File Path <span class="text-red-500">*</span></label>
              <input type="text" id="gcs-key-filename" name="gcs-key-filename" value="${config.keyFilename || ''}" class="z-1 w-full px-2 py-1.5 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-zinc-700" autocomplete="off" required>
            </div>
            <div class="flex space-x-4">
              <div class="w-1/2">
                <label for="sync-interval" class="block text-sm font-medium text-gray-700 dark:text-gray-400">Sync Interval
                <button class="ml-1 text-blue-600 text-lg hint--top-right hint--rounded hint--medium" aria-label="How often do you want to sync your data to cloud? Minimum 15 seconds">ⓘ</button></label>
                <input id="sync-interval" name="sync-interval" type="number" min="15" value="${
                  config.syncInterval
                }" class="z-1 w-full px-2 py-1.5 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-zinc-700" autocomplete="off" required>
              </div>
              <div class="w-1/2">
                <label for="encryption-key" class="block text-sm font-medium text-gray-700 dark:text-gray-400">
                  Encryption Key <span class="text-red-500">*</span>
                  <button class="ml-1 text-blue-600 text-lg hint--top-left hint--rounded hint--medium" aria-label="Choose a secure 8+ character string. This is to encrypt the backup file before uploading to cloud. Securely store this somewhere as you will need this to restore backup from cloud.">ⓘ</button>
                </label>
                <input id="encryption-key" name="encryption-key" type="password" value="${
                  config.encryptionKey || ""
                }" class="z-1 w-full px-2 py-1.5 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-zinc-700" autocomplete="off" required>
              </div>
            </div>
          </div>
        </div>
        <div class="flex items-center justify-end mb-4 space-x-2">
          <span class="text-sm text-gray-600 dark:text-gray-400">
            Console Logging
            <button class="ml-1 text-blue-600 text-lg hint--top-left hint--rounded hint--medium" aria-label="Use this to enable detailed logging in Browser console for troubleshooting purpose. Clicking on this button will instantly start logging. However, earlier events will not be logged. You could add ?log=true to the page URL and reload the page to start logging from the beginning of the page load.">ⓘ</button>
          </span>
          <input type="checkbox" id="console-logging-toggle" class="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded cursor-pointer">
        </div>
        <div class="flex justify-between space-x-2 mt-4">
          <button id="save-settings" class="z-1 inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-400 disabled:cursor-default transition-colors">
            Save
          </button>
          <div class="flex space-x-2">
            <button id="sync-now" class="z-1 inline-flex items-center px-2 py-1 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:bg-gray-400 disabled:cursor-default transition-colors">
              ${config.syncMode === "sync" ? "Sync Now" : "Backup Now"}
            </button>
            <button id="create-snapshot" class="z-1 inline-flex items-center px-2 py-1 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-400 disabled:cursor-default transition-colors">
              Snapshot
            </button>
            <button id="close-modal" class="z-1 inline-flex items-center px-2 py-1 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500">
              Close
            </button>
          </div>
        </div>
        <div class="text-center mt-4">
          <span id="last-sync-msg"></span>
        </div>
        <div id="action-msg" class="text-center"></div>
      </div>
    </div>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  modal.querySelector("#close-modal").addEventListener("click", closeModal);
  overlay.addEventListener("click", closeModal);
  modal.querySelector("#save-settings").addEventListener("click", saveSettings);
  modal.querySelector("#sync-now").addEventListener("click", () => {
    if (config.syncMode === "sync") {
      queueOperation("manual-sync", syncFromCloud);
    } else {
      queueOperation("manual-backup", syncToCloud);
    }
    updateSyncStatus();
  });
  modal.querySelector("#create-snapshot").addEventListener("click", () => {
    const name = prompt("Enter snapshot name:");
    if (name) {
      createSnapshot(name);
      updateSyncStatus();
    }
  });
  const syncModeRadios = modal.querySelectorAll('input[name="sync-mode"]');
  syncModeRadios.forEach((radio) => {
    radio.addEventListener("change", function () {
      const syncNowBtn = modal.querySelector("#sync-now");
      if (syncNowBtn) {
        syncNowBtn.textContent =
          this.value === "sync" ? "Sync Now" : "Backup Now";
      }
      const cloudSyncBtn = document.querySelector(
        '[data-element-id="cloud-sync-button"]'
      );
      if (cloudSyncBtn) {
        const buttonText = cloudSyncBtn.querySelector("span:last-child");
        if (buttonText) {
          buttonText.innerText =
            this.value === "disabled"
              ? "Cloud"
              : this.value === "sync"
              ? "Sync"
              : "Backup";
        }
      }
    });
  });
  const consoleLoggingCheckbox = modal.querySelector("#console-logging-toggle");
  consoleLoggingCheckbox.checked = isConsoleLoggingEnabled;
  consoleLoggingCheckbox.addEventListener("change", (e) => {
    isConsoleLoggingEnabled = e.target.checked;
    updateUrlLoggingParameter(isConsoleLoggingEnabled);
  });
  modal.addEventListener("click", (e) => e.stopPropagation());
  loadBackupList();
  updateSyncStatus();
}

async function saveSettings() {
  const newConfig = {
    projectId: document.getElementById("gcs-project-id").value,
    bucketName: document.getElementById("gcs-bucket").value,
    keyFilename: document.getElementById("gcs-key-filename").value,
    syncMode: document.querySelector('input[name="sync-mode"]:checked').value,
    syncInterval: parseInt(document.getElementById("sync-interval").value),
    encryptionKey: document.getElementById("encryption-key").value,
  };

  if (!newConfig.projectId || !newConfig.bucketName || !newConfig.keyFilename) {
      alert("Please fill in all required Google Cloud Storage settings");
      return;
  }
  if (newConfig.syncInterval < 15) {
    alert("Sync interval must be at least 15 seconds");
    return;
  }

  const oldMode = config.syncMode;
  config = { ...config, ...newConfig };
  saveConfiguration();
  if (oldMode === "disabled" && newConfig.syncMode !== "disabled") {
    operationState = {
      isImporting: false,
      isExporting: false,
      isPendingSync: false,
      operationQueue: [],
      isProcessingQueue: false,
      lastSyncStatus: null,
      isCheckingChanges: false,
      lastError: null,
      operationStartTime: null,
      queueProcessingPromise: null,
      completedOperations: new Set(),
      operationTimeouts: new Map(),
    };
    backupState = {
      isBackupInProgress: false,
      lastDailyBackup: null,
      lastManualSnapshot: null,
      backupInterval: null,
      isBackupIntervalRunning: false,
    };
    cloudFileSize = 0;
    localFileSize = 0;
    isLocalDataModified = false;
    pendingSettingsChanges = false;
    clearAllIntervals();
    logToConsole(
      "info",
      "State reset completed, proceeding with initialization"
    );
  }
  const buttonText = document.querySelector(
    "#cloud-sync-button span:last-child"
  );
  if (buttonText) {
    buttonText.innerText =
      config.syncMode === "disabled"
        ? "Cloud"
        : config.syncMode === "sync"
        ? "Sync"
        : "Backup";
  }
  updateSyncStatus();
  if (oldMode === "disabled" && newConfig.syncMode !== "disabled") {
    try {
      await performFullInitialization();
      logToConsole(
        "success",
        "Full initialization completed after mode switch"
      );
      if (isGcsConfigured()) {
        operationState.operationQueue = [];
        operationState.isProcessingQueue = false;
        try {
          const cloudMetadata = await downloadCloudMetadata();
          const cloudLastSync = cloudMetadata?.lastSyncTime || 0;
          const localLastSync = localMetadata?.lastSyncTime || 0;
          const cloudChatCount = Object.keys(cloudMetadata?.chats || {}).length;
          const localChatCount = Object.keys(localMetadata?.chats || {}).length;
          logToConsole("info", "Comparing metadata for sync direction", {
            cloudLastSync: new Date(cloudLastSync).toLocaleString(),
            localLastSync: new Date(localLastSync).toLocaleString(),
            cloudChats: cloudChatCount,
            localChats: localChatCount,
          });
          if (cloudLastSync > localLastSync && cloudChatCount > 0) {
            logToConsole(
              "info",
              "Cloud has newer data and chats, syncing from cloud"
            );
            queueOperation("force-initial-sync", async () => {
              logToConsole("start", "Performing forced sync from cloud");
              await syncFromCloud();
            });
          } else if (localChatCount > 0) {
            logToConsole("info", "Local data exists, syncing to cloud");
            queueOperation("force-initial-sync", async () => {
              logToConsole("start", "Performing forced sync to cloud");
              await syncToCloud();
            });
          }
        } catch (error) {
          logToConsole("error", "Error determining sync direction:", error);
          queueOperation("force-initial-sync", async () => {
            logToConsole("start", "Defaulting to sync from cloud after error");
            await syncFromCloud();
          });
        }
      }
    } catch (error) {
      logToConsole(
        "error",
        "Error during initialization after mode switch:",
        error
      );
      alert(
        "Error initializing cloud operations. Please check the console for details."
      );
    }
  } else if (isGcsConfigured()) {
    startSyncInterval();
    if (config.syncMode === "sync" && oldMode === "backup") {
      try {
        const cloudMetadata = await downloadCloudMetadata();
        const cloudLastSync = cloudMetadata?.lastSyncTime || 0;
        const localLastSync = localMetadata?.lastSyncTime || 0;
        const cloudChatCount = Object.keys(cloudMetadata?.chats || {}).length;
        const localChatCount = Object.keys(localMetadata?.chats || {}).length;
        logToConsole("info", "Comparing metadata for backup to sync switch", {
          cloudLastSync: new Date(cloudLastSync).toLocaleString(),
          localLastSync: new Date(localLastSync).toLocaleString(),
          cloudChats: cloudChatCount,
          localChats: localChatCount,
        });
        if (cloudChatCount === 0 && localChatCount > 0) {
          logToConsole("info", "Cloud is empty, syncing local data to cloud");
          queueOperation("mode-switch-sync", async () => {
            logToConsole("start", "Performing sync to cloud after mode switch");
            await syncToCloud();
          });
        } else if (cloudLastSync > localLastSync) {
          logToConsole("info", "Cloud has newer data, syncing from cloud");
          queueOperation("mode-switch-sync", async () => {
            logToConsole(
              "start",
              "Performing sync from cloud after mode switch"
            );
            await syncFromCloud();
          });
        } else if (localLastSync > cloudLastSync) {
          logToConsole("info", "Local has newer data, syncing to cloud");
          queueOperation("mode-switch-sync", async () => {
            logToConsole("start", "Performing sync to cloud after mode switch");
            await syncToCloud();
          });
        } else {
          if (cloudChatCount > localChatCount) {
            logToConsole("info", "Cloud has more chats, syncing from cloud");
            queueOperation("mode-switch-sync", async () => {
              logToConsole(
                "start",
                "Performing sync from cloud after mode switch"
              );
              await syncFromCloud();
            });
          } else {
            logToConsole(
              "info",
              "Local has equal or more chats, syncing to cloud"
            );
            queueOperation("mode-switch-sync", async () => {
              logToConsole(
                "start",
                "Performing sync to cloud after mode switch"
              );
              await syncToCloud();
            });
          }
        }
      } catch (error) {
        logToConsole(
          "error",
          "Error determining sync direction for mode switch:",
          error
        );
        queueOperation("mode-switch-sync", async () => {
          logToConsole(
            "start",
            "Defaulting to sync from cloud after error in mode switch"
          );
          await syncFromCloud();
        });
      }
    }
  }
  closeModal();
  logToConsole("success", "Settings saved");
  insertSyncButton();
  throttledCheckSyncStatus();
}

