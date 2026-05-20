function app() {
  return {

    connected:        false,
    activeTab:        'send',
    settingsOpen:     false,
    modalOpen:        false,
    codeCopied:       false,
    signalingUrl:     localStorage.getItem('signalingUrl') || 'https://peershare-gxd6.onrender.com',
    theme :           localStorage.getItem("theme") || "dark",
    selectedFile:     null,
    dragOver:         false,
    receiveCode:      '',
    codeChars:        ['','','','','',''],

    // transfer state
    role:             null,
    code:             null,
    transferState:    'idle',
    progress:         0,
    bytesTransferred: 0,
    fileMeta:         null,
    errorMessage:     null,
    statusMessage:    null,
    downloadUrl:      null,

    get progressLabel() {
      var s = this.transferState;
      if (s === 'waiting')      return 'Waiting for peer...';
      if (s === 'connected')    return 'Peer connected...';
      if (s === 'transferring') return this.progress + '%';
      if (s === 'done')         return 'Complete!';
      if (s === 'error')        return 'Error';
      return '';
    },
    get transferring()  { return this.transferState === 'transferring'; },
    get transferDone()  { return this.transferState === 'done'; },
    get transferError() { return this.transferState === 'error'; },
    get transferWaiting() {
      return this.transferState === 'waiting' || this.transferState === 'connected';
    },

    init() {
      var saved = localStorage.getItem('signalingUrl');
      if (saved) this.signalingUrl = saved;

      var savedTheme = localStorage.getItem('theme') || 'dark';
      this.theme = savedTheme;
      document.documentElement.setAttribute('data-theme', savedTheme);

      // expose self so external code can call update()
      window._app = this;

      document.addEventListener('file:selected', (e) => {
        if (e.detail && e.detail.file) this.selectedFile = e.detail.file;
      });

      TransferManager.init(this);
      localStorage.setItem('signalingUrl', this.signalingUrl);
      AppState.signalingUrl = this.signalingUrl;
      SocketManager.connect(this.signalingUrl);

      setInterval(() => {
        var now = SocketManager.isConnected();
        if (this.connected !== now) this.connected = now;
      }, 100);
    },

    // called by TransferManager directly with a patch object
    update(patch) {
      console.log("[app.update]", patch);
      for (var key in patch) {
        this[key] = patch[key];
      }
      console.log("[app.state] modalOpen=" + this.modalOpen + " transferState=" + this.transferState);
    },

    toggleTheme() {
      this.theme = this.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', this.theme);
      localStorage.setItem('theme', this.theme);
    },

    saveSettings() {
      localStorage.setItem('signalingUrl', this.signalingUrl);
      AppState.signalingUrl = this.signalingUrl;
      SocketManager.connect(this.signalingUrl);
      this.settingsOpen = false;
    },

    handleDrop(event) {
      this.dragOver = false;
      var file = event.dataTransfer && event.dataTransfer.files[0];
      if (file) this.selectedFile = file;
    },

    clearFile() {
      this.selectedFile = null;
      var inp = document.getElementById('fileInput');
      if (inp) inp.value = '';
    },

    startSend() {
      if (!this.selectedFile || !this.connected) return;
      this.role          = 'sender';
      this.transferState = 'waiting';
      this.statusMessage = 'Creating room...';
      this.fileMeta      = { name: this.selectedFile.name, size: this.selectedFile.size, type: this.selectedFile.type };
      this.errorMessage  = null;
      this.progress      = 0;
      this.bytesTransferred = 0;
      this.code          = null;
      this.downloadUrl   = null;
      this.modalOpen     = true;
      console.log("[startSend] modalOpen set to", this.modalOpen);
      TransferManager.startSend(this.selectedFile);
      console.log("[startSend] after TransferManager.startSend, modalOpen=", this.modalOpen);
    },


    handleCodeInput(event, index) {
      var val = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      event.target.value = val ? val[val.length-1] : '';
      var chars = this.codeChars.slice();
      chars[index] = event.target.value;
      this.codeChars = chars;
      this.receiveCode = chars.join('');
      // advance to next box
      if (event.target.value && index < 5) {
        var boxes = document.querySelectorAll('.code-box');
        if (boxes[index+1]) boxes[index+1].focus();
      }
      // auto-submit when all 6 filled
      if (this.receiveCode.length === 6 && this.connected) this.startReceive();
    },

    handleCodeKey(event, index) {
      if (event.key === 'Backspace') {
        var chars = this.codeChars.slice();
        if (chars[index]) {
          chars[index] = '';
          this.codeChars = chars;
          this.receiveCode = chars.join('');
        } else if (index > 0) {
          chars[index-1] = '';
          this.codeChars = chars;
          this.receiveCode = chars.join('');
          var boxes = document.querySelectorAll('.code-box');
          if (boxes[index-1]) boxes[index-1].focus();
        }
        event.preventDefault();
      }
      if (event.key === 'ArrowLeft' && index > 0) {
        var boxes = document.querySelectorAll('.code-box');
        boxes[index-1].focus();
      }
      if (event.key === 'ArrowRight' && index < 5) {
        var boxes = document.querySelectorAll('.code-box');
        boxes[index+1].focus();
      }
    },

    handleCodePaste(event) {
      event.preventDefault();
      var pasted = (event.clipboardData || window.clipboardData)
        .getData('text').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      var chars = ['','','','','',''];
      for (var i = 0; i < pasted.length; i++) chars[i] = pasted[i];
      this.codeChars = chars;
      this.receiveCode = chars.join('');
      // update DOM and focus last filled box
      var boxes = document.querySelectorAll('.code-box');
      boxes.forEach(function(b, i) { b.value = chars[i] || ''; });
      var focus = Math.min(pasted.length, 5);
      boxes[focus].focus();
      if (pasted.length === 6 && this.connected) this.startReceive();
    },

    startReceive() {
      var code = this.receiveCode.trim().toUpperCase();
      if (code.length !== 6 || !this.connected) return;
      this.role          = 'receiver';
      this.transferState = 'waiting';
      this.statusMessage = 'Joining room...';
      this.code          = code;
      this.errorMessage  = null;
      this.progress      = 0;
      this.bytesTransferred = 0;
      this.fileMeta      = null;
      this.downloadUrl   = null;
      this.modalOpen     = true;
      TransferManager.startReceive(this.receiveCode);
    },

    closeModal() {
      if (!this.modalOpen) return;  // guard: don't fire when hidden
      TransferManager.cancel();
      this._resetTransfer();
    },

    _resetTransfer() {
      this.clearFile();
      this.receiveCode      = '';
      this.codeChars        = ['','','','','',''];
      document.querySelectorAll('.code-box').forEach(function(b){ b.value=''; });
      this.modalOpen        = false;
      this.role             = null;
      this.code             = null;
      this.transferState    = 'idle';
      this.progress         = 0;
      this.bytesTransferred = 0;
      this.fileMeta         = null;
      this.errorMessage     = null;
      this.statusMessage    = null;
      this.downloadUrl      = null;
    },

    copyCode() {
      if (!this.code) return;
      var code = this.code;
      navigator.clipboard.writeText(code).then(() => {
        this.codeCopied = true;
        setTimeout(() => { this.codeCopied = false; }, 2000);
      }).catch(() => {
        var el = document.createElement('textarea');
        el.value = code;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        this.codeCopied = true;
        setTimeout(() => { this.codeCopied = false; }, 2000);
      });
    },

    downloadFile() {
      if (!this.downloadUrl) return;
      var a = document.createElement('a');
      a.href     = this.downloadUrl;
      a.download = 'Download';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    },

    formatBytes(bytes) {
      if (!bytes || bytes === 0) return '0 B';
      var k = 1024, sizes = ['B','KB','MB','GB','TB'];
      var i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    },

    formatCode(code) {
      return code ? String(code).toUpperCase() : '------';
    },
  };
}