/**
 * TypingMind Cloud Backup System - Core Module
 * This module provides cloud backup functionality for TypingMind app data.
 */

// Configuration and runtime state
const config = {
  syncMode: "disabled",
  syncHour: 9, 
  syncMinute: 0,
  projectId: "",
  bucketName: "",
  keyFilename: "",
  encryptionKey: "",
  encryptionEnabled: false, // New option to toggle encryption on/off, default off
  lastSyncTime: 0,
  lastSyncDate: ""
};

let gcsClient = null;
let isConsoleLoggingEnabled = false;
let syncIntervalId = null;
let isRunning = false;
let localMetadata = null;
let cloudMetadata = null;

// Utility: Console logging
function logToConsole(level, message, data = null) {
  if (!isConsoleLoggingEnabled && level !== "error") return;
  
  const timestamp = new Date().toLocaleTimeString();
  const prefix = `[TypingMind Cloud] ${timestamp} [${level.toUpperCase()}]`;
  
  switch (level) {
    case "error": console.error(prefix, message, data || ''); break;
    case "warn": console.warn(prefix, message, data || ''); break;
    case "success": console.log(`%c${prefix} ${message}`, 'color: green', data || ''); break;
    case "info": console.info(prefix, message, data || ''); break;
    default: console.log(prefix, message, data || '');
  }
}

// Configuration: Load from localStorage
function loadConfiguration() {
  try {
    const storedConfig = {
      bucketName: localStorage.getItem("gcs-bucket"),
      projectId: localStorage.getItem("gcs-project-id"),
      keyFilename: localStorage.getItem("gcs-key-filename"),
      syncHour: parseInt(localStorage.getItem("sync-hour")) || 9,
      syncMinute: parseInt(localStorage.getItem("sync-minute")) || 0,
      encryptionKey: localStorage.getItem("encryption-key"),
      encryptionEnabled: localStorage.getItem("encryption-enabled") === "true",
      syncMode: localStorage.getItem("sync-mode") || "disabled",
      lastSyncTime: parseInt(localStorage.getItem("last-sync-time")) || 0,
      lastSyncDate: localStorage.getItem("last-sync-date") || ""
    };
    
    // Update config
    Object.assign(config, storedConfig);
    logToConsole("info", "Configuration loaded");
  } catch (error) {
    logToConsole("error", "Failed to load configuration", error);
  }
}

// Configuration: Save to localStorage
function saveConfiguration() {
  try {
    localStorage.setItem("gcs-bucket", config.bucketName);
    localStorage.setItem("gcs-project-id", config.projectId);
    localStorage.setItem("gcs-key-filename", config.keyFilename);
    localStorage.setItem("sync-hour", config.syncHour.toString());
    localStorage.setItem("sync-minute", config.syncMinute.toString());
    localStorage.setItem("encryption-key", config.encryptionKey);
    localStorage.setItem("encryption-enabled", config.encryptionEnabled.toString());
    localStorage.setItem("sync-mode", config.syncMode);
    localStorage.setItem("last-sync-time", config.lastSyncTime.toString());
    localStorage.setItem("last-sync-date", config.lastSyncDate);
    
    logToConsole("info", "Configuration saved");
  } catch (error) {
    logToConsole("error", "Failed to save configuration", error);
  }
}

// GCS: Check if properly configured
function isGcsConfigured() {
  return !!(config.projectId && config.keyFilename && config.bucketName);
}

// GCS: Initialize client
function initializeGCSClient() {
  if (!isGcsConfigured()) {
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
    logToConsole("error", "Error initializing GCS client:", error);
    throw error;
  }
}

// GCS: Upload file
async function uploadToGCS(key, data, metadata = {}) {
  try {
    const gcs = initializeGCSClient();
    const bucket = gcs.bucket(config.bucketName);
    const contentType = key.endsWith(".json") ? "application/json" : 
                        key.endsWith(".zip") ? "application/zip" : 
                        "application/octet-stream";
    
    const options = {
      destination: key,
      metadata: {
        metadata: metadata,
        contentType: contentType
      },
    };
    
    await bucket.upload(data, options);
    logToConsole("success", `Successfully uploaded to GCS: ${key}`);
    return true;
  } catch (error) {
    logToConsole("error", `Failed to upload to GCS: ${key}`, error);
    throw error;
  }
}

// GCS: Download file
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

// GCS: List files
async function listGCSObjects(prefix = "") {
  try {
    const gcs = initializeGCSClient();
    const bucket = gcs.bucket(config.bucketName);
    const [files] = await bucket.getFiles({ prefix: prefix });

    return await Promise.all(files.map(async (file) => {
      try {
        const [metadata] = await file.getMetadata();
        return {
          Key: file.name,
          Size: metadata.size,
          LastModified: metadata.updated,
          metadata: metadata.metadata || {},
        };
      } catch (error) {
        return {
          Key: file.name,
          Size: 0,
          LastModified: null,
          metadata: {},
        };
      }
    }));
  } catch (error) {
    logToConsole("error", "Failed to list GCS objects:", error);
    throw error;
  }
}

// GCS: Delete file
async function deleteFromGCS(key) {
  try {
    const gcs = initializeGCSClient();
    const bucket = gcs.bucket(config.bucketName);
    const file = bucket.file(key);
    await file.delete();
    logToConsole("success", `Successfully deleted from GCS: ${key}`);
    return true;
  } catch (error) {
    logToConsole("error", `Failed to delete from GCS: ${key}`, error);
    throw error;
  }
}

// Encryption: Generate random bytes
function getRandomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

// Encryption: Derive key from password
async function deriveKey(password, salt, iterations = 100000) {
  try {
    const passwordBytes = typeof password === 'string' ? 
      new TextEncoder().encode(password) : password;
    
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      passwordBytes,
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );
    
    return await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: iterations,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  } catch (error) {
    logToConsole("error", "Key derivation failed", error);
    throw new Error('Failed to derive encryption key');
  }
}

// Encryption: Encrypt data
async function encryptData(data, password) {
  try {
    const salt = getRandomBytes(16);
    const iv = getRandomBytes(12);
    const key = await deriveKey(password, salt);
    
    const dataBuffer = typeof data === 'string' ? 
      new TextEncoder().encode(data) : data;
    
    const encryptedData = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv,
        tagLength: 128
      },
      key,
      dataBuffer
    );
    
    // Create header
    const header = {
      version: 1,
      algorithm: 'AES-GCM',
      keyDerivation: 'PBKDF2',
      iterations: 100000,
      saltSize: salt.length,
      ivSize: iv.length,
      timestamp: Date.now()
    };
    
    const headerString = JSON.stringify(header);
    const headerBytes = new TextEncoder().encode(headerString);
    const headerLength = new Uint32Array([headerBytes.length]);
    
    // Combine everything
    const result = new Uint8Array(
      4 + headerBytes.length + salt.length + iv.length + encryptedData.byteLength
    );
    
    result.set(new Uint8Array(headerLength.buffer), 0);
    result.set(headerBytes, 4);
    result.set(salt, 4 + headerBytes.length);
    result.set(iv, 4 + headerBytes.length + salt.length);
    result.set(
      new Uint8Array(encryptedData), 
      4 + headerBytes.length + salt.length + iv.length
    );
    
    return result.buffer;
  } catch (error) {
    logToConsole("error", "Encryption failed", error);
    throw new Error('Failed to encrypt data');
  }
}

// Encryption: Decrypt data
async function decryptData(encryptedData, password) {
  try {
    const dataView = new DataView(encryptedData);
    const headerLength = dataView.getUint32(0, true);
    
    const headerBytes = new Uint8Array(encryptedData, 4, headerLength);
    const headerString = new TextDecoder().decode(headerBytes);
    const header = JSON.parse(headerString);
    
    if (header.version > 1) {
      throw new Error(`Unsupported encryption format version: ${header.version}`);
    }
    
    const saltOffset = 4 + headerLength;
    const ivOffset = saltOffset + header.saltSize;
    const dataOffset = ivOffset + header.ivSize;
    
    const salt = new Uint8Array(encryptedData, saltOffset, header.saltSize);
    const iv = new Uint8Array(encryptedData, ivOffset, header.ivSize);
    const data = new Uint8Array(encryptedData, dataOffset);
    
    const key = await deriveKey(password, salt, header.iterations);
    
    const decryptedData = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv,
        tagLength: 128
      },
      key,
      data
    );
    
    return decryptedData;
  } catch (error) {
    if (error.name === 'OperationError') {
      throw new Error('Decryption failed: Invalid password or corrupted data');
    }
    
    logToConsole("error", "Decryption failed", error);
    throw new Error('Failed to decrypt data');
  }
}

// Data: Get application data
async function getApplicationData() {
  try {
    const chats = JSON.parse(localStorage.getItem('chats') || '{}');
    const settings = JSON.parse(localStorage.getItem('settings') || '{}');
    const favorites = JSON.parse(localStorage.getItem('favorites') || '[]');
    const folders = JSON.parse(localStorage.getItem('folders') || '[]');
    
    return {
      chats,
      settings,
      favorites,
      folders,
      timestamp: Date.now()
    };
  } catch (error) {
    logToConsole("error", "Error getting application data:", error);
    throw error;
  }
}

// Data: Restore application data
async function restoreApplicationData(data) {
  try {
    if (!data || !data.chats) {
      throw new Error('Invalid data structure');
    }
    
    if (data.chats) localStorage.setItem('chats', JSON.stringify(data.chats));
    if (data.settings) localStorage.setItem('settings', JSON.stringify(data.settings));
    if (data.favorites) localStorage.setItem('favorites', JSON.stringify(data.favorites));
    if (data.folders) localStorage.setItem('folders', JSON.stringify(data.folders));
    
    localMetadata = {
      data: data,
      timestamp: Date.now()
    };
    
    logToConsole("success", "Application data restored");
    return true;
  } catch (error) {
    logToConsole("error", "Error restoring application data:", error);
    throw error;
  }
}

// Data: Get local metadata
async function getLocalMetadata() {
  if (localMetadata) {
    return localMetadata;
  }
  
  try {
    const appData = await getApplicationData();
    localMetadata = {
      data: appData,
      timestamp: Date.now()
    };
    return localMetadata;
  } catch (error) {
    logToConsole("error", "Error getting local metadata:", error);
    throw error;
  }
}

// Data: Get cloud metadata
async function getCloudMetadata() {
  if (cloudMetadata) {
    return cloudMetadata;
  }
  
  try {
    const result = await downloadFromGCS('typingmind-metadata.json');
    
    if (!result || !result.data) {
      throw new Error('No cloud metadata found');
    }
    
    const jsonString = new TextDecoder().decode(result.data);
    cloudMetadata = JSON.parse(jsonString);
    
    return cloudMetadata;
  } catch (error) {
    logToConsole("error", "Error getting cloud metadata:", error);
    throw error;
  }
}

// Data: Save cloud metadata
async function saveCloudMetadata(data) {
  try {
    const jsonString = JSON.stringify(data);
    const buffer = new TextEncoder().encode(jsonString);
    
    await uploadToGCS('typingmind-metadata.json', buffer, {
      contentType: 'application/json',
      timestamp: Date.now().toString()
    });
    
    cloudMetadata = data;
    
    logToConsole("info", "Cloud metadata saved");
    return true;
  } catch (error) {
    logToConsole("error", "Error saving cloud metadata:", error);
    throw error;
  }
}

// Sync: Check if it's time for daily sync
function isDailySyncTime() {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  
  if (config.lastSyncDate === today) {
    return false;
  }
  
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  
  return (currentHour > config.syncHour || 
         (currentHour === config.syncHour && currentMinute >= config.syncMinute));
}

// Sync: Start interval
function startSyncInterval() {
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
  }
  
  if (config.syncMode === "disabled") {
    return;
  }
  
  syncIntervalId = setInterval(async () => {
    if (!isRunning && isDailySyncTime()) {
      try {
        logToConsole("info", `Running daily sync at ${config.syncHour}:${config.syncMinute.toString().padStart(2, '0')}`);
        await performSync();
        
        const today = new Date().toISOString().split('T')[0];
        config.lastSyncDate = today;
        saveConfiguration();
      } catch (error) {
        logToConsole("error", "Error during scheduled daily sync:", error);
      }
    }
  }, 60000);
  
  logToConsole("info", `Daily sync scheduler set for ${config.syncHour}:${config.syncMinute.toString().padStart(2, '0')}`);
}

// Sync: Stop interval
function stopSyncInterval() {
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
  }
}

// Sync: Push to cloud
async function pushToCloud(localData) {
  logToConsole("info", "Starting push to cloud");
  
  try {
    const appData = localData || await getApplicationData();
    
    const dataToSync = {
      data: appData,
      timestamp: Date.now()
    };
    
    const jsonData = JSON.stringify(dataToSync);
    
    let uploadData;
    let contentType = 'application/json';
    
    if (config.encryptionEnabled) {
      const encryptionKey = config.encryptionKey;
      if (!encryptionKey) {
        throw new Error('Encryption key not configured but encryption is enabled');
      }
      
      logToConsole("debug", "Encrypting data for cloud storage");
      uploadData = await encryptData(jsonData, encryptionKey);
      contentType = 'application/octet-stream';
    } else {
      logToConsole("debug", "Uploading unencrypted data (encryption disabled)");
      uploadData = new TextEncoder().encode(jsonData);
    }
    
    const fileExt = config.encryptionEnabled ? '.dat' : '.json';
    const syncKey = `typingmind-backup-${new Date().toISOString().split('T')[0]}${fileExt}`;
    
    logToConsole("debug", `Uploading to cloud with key: ${syncKey}`);
    await uploadToGCS(syncKey, uploadData, {
      contentType: contentType,
      syncType: 'regular',
      encrypted: config.encryptionEnabled.toString(),
      timestamp: Date.now().toString()
    });
    
    await saveCloudMetadata(dataToSync);
    
    logToConsole("info", "Successfully pushed data to cloud");
    return true;
  } catch (error) {
    logToConsole("error", "Error pushing to cloud:", error);
    throw error;
  }
}

// Sync: Pull from cloud
async function pullFromCloud() {
  logToConsole("info", "Starting pull from cloud");
  
  try {
    // We'll need to search for both .dat (encrypted) and .json (unencrypted) files
    const files = await listGCSObjects('typingmind-backup-');
    
    if (!files || files.length === 0) {
      throw new Error('No backups found in cloud storage');
    }
    
    // Sort files by timestamp, newest first
    files.sort((a, b) => {
      const aTime = a.metadata?.timestamp ? parseInt(a.metadata.timestamp) : 0;
      const bTime = b.metadata?.timestamp ? parseInt(b.metadata.timestamp) : 0;
      return bTime - aTime;
    });
    
    const latestBackup = files[0];
    logToConsole("debug", `Downloading latest backup: ${latestBackup.Key}`);
    
    const downloadResult = await downloadFromGCS(latestBackup.Key);
    
    if (!downloadResult || !downloadResult.data) {
      throw new Error('Failed to download backup from cloud');
    }
    
    let jsonString;
    const isEncrypted = latestBackup.metadata?.encrypted === "true" || latestBackup.Key.endsWith('.dat');
    
    if (isEncrypted) {
      const encryptionKey = config.encryptionKey;
      if (!encryptionKey) {
        throw new Error('Encryption key not configured but the backup is encrypted');
      }
      
      logToConsole("debug", "Decrypting backup data");
      const decryptedData = await decryptData(downloadResult.data, encryptionKey);
      jsonString = new TextDecoder().decode(decryptedData);
    } else {
      logToConsole("debug", "Processing unencrypted backup");
      jsonString = new TextDecoder().decode(downloadResult.data);
    }
    
    const syncData = JSON.parse(jsonString);
    
    if (!syncData.data) {
      throw new Error('Invalid backup data structure');
    }
    
    logToConsole("debug", "Restoring application data");
    await restoreApplicationData(syncData.data);
    
    cloudMetadata = syncData;
    
    logToConsole("info", "Successfully pulled data from cloud");
    return true;
  } catch (error) {
    logToConsole("error", "Error pulling from cloud:", error);
    throw error;
  }
}

// Sync: Determine sync direction
async function determineAndPerformSync(localData) {
  try {
    if (config.syncMode === "backup") {
      logToConsole("info", "In backup mode - pushing to cloud");
      return await pushToCloud(localData);
    }
    
    let cloudData = null;
    try {
      cloudData = await getCloudMetadata();
    } catch (error) {
      logToConsole("info", "No cloud metadata found - pushing to cloud");
      return await pushToCloud(localData);
    }
    
    const cloudLastSync = cloudData.timestamp || 0;
    const localLastSync = localData.timestamp || 0;
    
    const cloudItemCount = cloudData.data && cloudData.data.chats ? 
      Object.keys(cloudData.data.chats).length : 0;
    const localItemCount = localData.data && localData.data.chats ? 
      Object.keys(localData.data.chats).length : 0;
    
    logToConsole("info", "Comparing data for sync direction", {
      cloudLastSync: new Date(cloudLastSync).toLocaleString(),
      localLastSync: new Date(localLastSync).toLocaleString(),
      cloudItems: cloudItemCount,
      localItems: localItemCount
    });
    
    if (cloudLastSync > localLastSync && cloudItemCount > 0) {
      logToConsole("info", "Cloud has newer data - pulling from cloud");
      return await pullFromCloud();
    } else if (localLastSync > cloudLastSync && localItemCount > 0) {
      logToConsole("info", "Local has newer data - pushing to cloud");
      return await pushToCloud(localData);
    } else {
      if (cloudItemCount > localItemCount) {
        logToConsole("info", "Cloud has more items - pulling from cloud");
        return await pullFromCloud();
      } else {
        logToConsole("info", "Local has equal or more items - pushing to cloud");
        return await pushToCloud(localData);
      }
    }
  } catch (error) {
    logToConsole("error", "Error determining sync direction:", error);
    throw error;
  }
}

// Sync: Main sync function
async function performSync(options = {}) {
  if (isRunning) {
    return false;
  }
  
  if (!isGcsConfigured()) {
    logToConsole("error", "GCS is not configured");
    return false;
  }
  
  if (config.syncMode === "disabled" && !options.force) {
    logToConsole("info", "Sync is disabled");
    return false;
  }
  
  isRunning = true;
  
  try {
    const localData = await getLocalMetadata();
    const forceDirection = options.direction || null;
    
    if (forceDirection === 'push') {
      await pushToCloud(localData);
    } else if (forceDirection === 'pull') {
      await pullFromCloud();
    } else {
      await determineAndPerformSync(localData);
    }
    
    config.lastSyncTime = Date.now();
    saveConfiguration();
    
    logToConsole("info", "Synchronization completed successfully");
    return true;
  } catch (error) {
    logToConsole("error", "Synchronization failed:", error);
    return false;
  } finally {
    isRunning = false;
  }
}

// UI: Add styles
function addStyles() {
  if (!document.getElementById('typingmind-cloud-styles')) {
    const style = document.createElement('style');
    style.id = 'typingmind-cloud-styles';
    style.textContent = `
      .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1000;
      }
      
      .cloud-sync-modal {
        background-color: white;
        border-radius: 8px;
        padding: 20px;
        max-width: 600px;
        width: 90%;
        max-height: 90vh;
        overflow-y: auto;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        position: relative;
        z-index: 1001;
      }
      
      .dark .cloud-sync-modal {
        background-color: #1e1e1e;
        color: #fff;
      }
      
      #cloud-sync-button {
        display: flex;
        align-items: center;
        gap: 5px;
        padding: 5px 10px;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s;
      }
    `;
    document.head.appendChild(style);
  }
}

// UI: Insert sync button
function insertSyncButton() {
  if (document.getElementById('cloud-sync-button')) {
    return;
  }
  
  const targetElement = document.querySelector('.sidebar .sidebar-nav .flex.justify-end');
  if (!targetElement) {
    logToConsole("warn", "Could not find target element for sync button");
    return;
  }
  
  const button = document.createElement('div');
  button.id = 'cloud-sync-button';
  button.setAttribute('data-element-id', 'cloud-sync-button');
  button.className = 'text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition';
  button.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-cloud">
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path>
    </svg>
    <span class="hidden sm:inline">${config.syncMode === "disabled" ? "Cloud" : config.syncMode === "sync" ? "Sync" : "Backup"}</span>
  `;
  
  button.addEventListener('click', openSyncModal);
  targetElement.appendChild(button);
  
  logToConsole("info", "Sync button inserted");
}

// UI: Update sync button text
function updateSyncButtonText() {
  const buttonText = document.querySelector('#cloud-sync-button span');
  if (buttonText) {
    buttonText.textContent = config.syncMode === "disabled" ? "Cloud" : config.syncMode === "sync" ? "Sync" : "Backup";
  }
}

// UI: Setup event listeners 
function setupEventListeners() {
  // Global event listener for encryption toggle
  document.addEventListener('click', (event) => {
    if (event.target.id === 'encryption-toggle') {
      config.encryptionEnabled = event.target.checked;
      
      // Show/hide encryption key field based on toggle
      const encryptionKeyContainer = document.getElementById('encryption-key-container');
      if (encryptionKeyContainer) {
        encryptionKeyContainer.style.display = config.encryptionEnabled ? 'block' : 'none';
      }
      
      logToConsole("info", `Encryption ${config.encryptionEnabled ? 'enabled' : 'disabled'}`);
    }
  });
  
  logToConsole("debug", "Event listeners setup");
}

// UI: Open sync modal
function openSyncModal() {
  logToConsole("info", "Sync modal opened");
  
  // Check if modal already exists
  if (document.querySelector('.cloud-sync-modal')) {
    return;
  }
  
  // Create overlay and modal
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  
  const modal = document.createElement('div');
  modal.className = 'cloud-sync-modal';
  
  // Create modal content with encryption toggle
  modal.innerHTML = `
    <div class="text-gray-800 dark:text-white text-left text-sm">
      <div class="flex justify-center items-center mb-3">
        <h3 class="text-center text-xl font-bold">Cloud Backup & Sync Settings</h3>
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
              </label>
              <label class="inline-flex items-center">
                <input type="radio" name="sync-mode" value="backup" class="form-radio text-blue-600" ${
                  config.syncMode === "backup" ? "checked" : ""
                }>
                <span class="ml-2">Backup</span>
              </label>
              <label class="inline-flex items-center">
                <input type="radio" name="sync-mode" value="disabled" class="form-radio text-blue-600" ${
                  config.syncMode === "disabled" ? "checked" : ""
                }>
                <span class="ml-2">Disabled</span>
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
                <label for="sync-hour" class="block text-sm font-medium text-gray-700 dark:text-gray-400">Sync Hour (0-23)</label>
                <input id="sync-hour" name="sync-hour" type="number" min="0" max="23" value="${
                  config.syncHour
                }" class="z-1 w-full px-2 py-1.5 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-zinc-700" autocomplete="off" required>
              </div>
              <div class="w-1/2">
                <label for="sync-minute" class="block text-sm font-medium text-gray-700 dark:text-gray-400">Sync Minute (0-59)</label>
                <input id="sync-minute" name="sync-minute" type="number" min="0" max="59" value="${
                  config.syncMinute
                }" class="z-1 w-full px-2 py-1.5 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-zinc-700" autocomplete="off" required>
              </div>
            </div>
            
            <!-- Encryption Toggle -->
            <div class="form-group mt-4">
              <div class="flex items-center mb-2">
                <label class="text-sm font-medium text-gray-700 dark:text-gray-400 mr-2">Enable Encryption:</label>
                <label class="inline-flex items-center cursor-pointer">
                  <input type="checkbox" id="encryption-toggle" class="form-checkbox h-4 w-4 text-blue-600 transition duration-150 ease-in-out" ${config.encryptionEnabled ? 'checked' : ''}>
                  <span class="ml-2 text-sm text-gray-700 dark:text-gray-400">${config.encryptionEnabled ? 'Encrypted' : 'Unencrypted'}</span>
                </label>
              </div>
              
              <!-- Encryption Key Field (hidden when encryption is disabled) -->
              <div id="encryption-key-container" style="display: ${config.encryptionEnabled ? 'block' : 'none'}">
                <label for="encryption-key" class="block text-sm font-medium text-gray-700 dark:text-gray-400">
                  Encryption Key ${config.encryptionEnabled ? '<span class="text-red-500">*</span>' : ''}
                </label>
                <input id="encryption-key" name="encryption-key" type="password" value="${
                  config.encryptionKey || ""
                }" class="z-1 w-full px-2 py-1.5 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm dark:bg-zinc-700" autocomplete="off" ${config.encryptionEnabled ? 'required' : ''}>
                <p class="text-xs text-gray-500 mt-1">Securely store this key, as it will be needed to restore encrypted backups.</p>
              </div>
            </div>
          </div>
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
        <div id="last-sync-msg" class="text-center mt-3 text-sm text-gray-600 dark:text-gray-400"></div>
        <div id="action-msg" class="text-center mt-2"></div>
      </div>
    </div>
  `;
  
  // Attach modal to DOM
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  
  // Set up event listeners for modal
  const closeModal = () => {
    if (overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
  };
  
  // Update last sync message
  updateLastSyncMsg();
  
  // Close modal when clicking outside or on close button
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeModal();
    }
  });
  
  const closeBtn = modal.querySelector('#close-modal');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeModal);
  }
  
  // Save settings
  const saveBtn = modal.querySelector('#save-settings');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      // Get values from form
      config.projectId = document.getElementById('gcs-project-id').value;
      config.bucketName = document.getElementById('gcs-bucket').value;
      config.keyFilename = document.getElementById('gcs-key-filename').value;
      config.syncHour = parseInt(document.getElementById('sync-hour').value) || 9;
      config.syncMinute = parseInt(document.getElementById('sync-minute').value) || 0;
      config.syncMode = document.querySelector('input[name="sync-mode"]:checked').value;
      config.encryptionEnabled = document.getElementById('encryption-toggle').checked;
      
      if (config.encryptionEnabled) {
        config.encryptionKey = document.getElementById('encryption-key').value;
        if (!config.encryptionKey && config.encryptionEnabled) {
          alert('Encryption key is required when encryption is enabled');
          return;
        }
      }
      
      // Save configuration
      saveConfiguration();
      
      // Update UI
      updateSyncButtonText();
      
      // Close modal
      closeModal();
      
      // Restart sync interval if needed
      if (config.syncMode !== 'disabled') {
        startSyncInterval();
      } else {
        stopSyncInterval();
      }
      
      logToConsole('success', 'Settings saved successfully');
    });
  }
  
  // Toggle encryption key field visibility when encryption toggle changes
  const encryptionToggle = modal.querySelector('#encryption-toggle');
  if (encryptionToggle) {
    encryptionToggle.addEventListener('change', (e) => {
      const isEnabled = e.target.checked;
      const keyContainer = modal.querySelector('#encryption-key-container');
      if (keyContainer) {
        keyContainer.style.display = isEnabled ? 'block' : 'none';
      }
      
      // Update label
      const toggleLabel = e.target.nextElementSibling;
      if (toggleLabel) {
        toggleLabel.textContent = isEnabled ? 'Encrypted' : 'Unencrypted';
      }
    });
  }
  
  // Sync now button
  const syncNowBtn = modal.querySelector('#sync-now');
  if (syncNowBtn) {
    syncNowBtn.addEventListener('click', async () => {
      try {
        await performSync({ force: true });
        updateLastSyncMsg();
      } catch (error) {
        logToConsole('error', 'Error during manual sync:', error);
        showActionMessage(`Sync error: ${error.message}`, 'error');
      }
    });
  }
  
  // Create snapshot button
  const snapshotBtn = modal.querySelector('#create-snapshot');
  if (snapshotBtn) {
    snapshotBtn.addEventListener('click', async () => {
      const name = prompt('Enter snapshot name (optional):');
      try {
        await window.CloudBackup.createSnapshot(name);
        showActionMessage('Snapshot created successfully', 'success');
      } catch (error) {
        logToConsole('error', 'Error creating snapshot:', error);
        showActionMessage(`Snapshot error: ${error.message}`, 'error');
      }
    });
  }
}

// Initialize on load
if (typeof window !== 'undefined') {
  window.CloudBackup = {
    performSync,
    createSnapshot: async (name) => {
      // Simplified snapshot creation
      const appData = await getApplicationData();
      const dataToSync = {
        data: appData,
        timestamp: Date.now(),
        isSnapshot: true,
        snapshotName: name || `Snapshot ${new Date().toLocaleString()}`
      };
      
      const jsonData = JSON.stringify(dataToSync);
      
      let uploadData;
      let contentType = 'application/json';
      const fileExt = config.encryptionEnabled ? '.dat' : '.json';
      
      if (config.encryptionEnabled) {
        if (!config.encryptionKey) {
          throw new Error('Encryption key not configured but encryption is enabled');
        }
        uploadData = await encryptData(jsonData, config.encryptionKey);
        contentType = 'application/octet-stream';
      } else {
        uploadData = new TextEncoder().encode(jsonData);
      }
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const snapshotKey = `typingmind-snapshot-${timestamp}${fileExt}`;
      
      await uploadToGCS(snapshotKey, uploadData, {
        contentType: contentType,
        syncType: 'snapshot',
        encrypted: config.encryptionEnabled.toString(),
        timestamp: Date.now().toString(),
        name: name || `Snapshot ${new Date().toLocaleString()}`
      });
      
      logToConsole("info", "Snapshot created successfully");
      return true;
    }
  };
}
