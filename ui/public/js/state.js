// state.js — global ephemeral state, attached to window
// No persistence, no localStorage. Everything dies on page reload.

window.AppState = {
  // Socket connection
  connected: false,
  signalingUrl: localStorage.getItem('signalingUrl') || 'https://peershare-gxd6.onrender.com',

  // Current role: null | 'sender' | 'receiver'
  role: null,

  // Room
  code: null,          // 6-char code
  peerReady: false,    // both peers in room

  // File (sender side)
  selectedFile: null,  // File object
  fileMeta: null,      // { name, size, type }

  // Transfer
  transferState: 'idle', // idle | waiting | connected | transferring | done | error | cancelled
  progress: 0,           // 0–100
  bytesTransferred: 0,
  totalBytes: 0,

  // WebRTC
  peerConnection: null,
  dataChannel: null,

  // Receiver download
  receivedBlob: null,
  downloadUrl: null,

  // UI
  modalOpen: false,
  settingsOpen: false,
  activeTab: 'send',
  errorMessage: null,
  statusMessage: null,
  theme : localStorage.getItem("theme") || "dark",

  reset() {
    this.role = null;
    this.code = null;
    this.peerReady = false;
    this.selectedFile = null;
    this.fileMeta = null;
    this.transferState = 'idle';
    this.progress = 0;
    this.bytesTransferred = 0;
    this.totalBytes = 0;
    this.peerConnection = null;
    this.dataChannel = null;
    this.receivedBlob = null;
    if (this.downloadUrl) {
      URL.revokeObjectURL(this.downloadUrl);
      this.downloadUrl = null;
    }
    this.modalOpen = false;
    this.errorMessage = null;
    this.statusMessage = null;
  },
};
