    // =================== UI Constants ===================
    var FOLDER_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>';

    // =================== State ===================
    var allDownloadFiles = [];
    var selectedDownloadFiles = {};
    var downloadCurrentPrefix = '';
    var uploadCurrentPrefix = '';
    var downloadCurrentSearch = '';
    var downloadCurrentTotal = 0;
    var currentDownloadPage = 1;
    var downloadPageSize = 10;
    var totalDownloadPages = 1;
    var currentDownloadSearchType = 'contains';
    var uploadFiles = [];
    var activeDownloads = {};
    var uploadId = '';
    var progressTimer = null;
    // For cancel support
    var currentUploadXhr = null;
    var currentDownloadXhr = null;
    var currentTransferType = null; // 'upload' | 'download' | null

    // =================== Tab Navigation ===================
    document.querySelectorAll('.nav-item').forEach(function(item) {
        item.addEventListener('click', function() {
            document.querySelectorAll('.nav-item').forEach(function(el) { el.classList.remove('active'); });
            this.classList.add('active');
            var panel = this.getAttribute('data-panel');
            document.querySelectorAll('.panel').forEach(function(p) { p.classList.remove('active'); });
            document.getElementById('panel-' + panel).classList.add('active');
            document.getElementById('pageTitle').textContent = this.textContent.trim();
        });
    });

    // =================== Sidebar Toggle ===================
    function toggleSidebar() {
        var sidebar = document.getElementById('sidebar');
        sidebar.classList.toggle('expanded');
        var isExpanded = sidebar.classList.contains('expanded');
        try { localStorage.setItem('ui_sidebar_expanded', isExpanded ? '1' : '0'); } catch(e) {}
        var toggle = document.getElementById('sidebarToggle');
        if (toggle) {
            toggle.innerHTML = isExpanded ? '&#10094;' : '&#10095;';
            toggle.title = isExpanded ? '收缩' : '展开';
        }
        var progress = document.getElementById('bottomProgress');
        if (progress) {
            progress.style.left = isExpanded ? '200px' : '56px';
        }
    }

    // =================== API Request ===================
    // 前端唯一的 URL 分流入口：/rs、/minio 开头的路径原样返回，
    // 其余短路径（如 /config、/buckets、/upload）拼 MinIO 前缀。
    // 所有请求（含流式下载、AI 对话、上传进度等原生 fetch/XHR）都必须经此函数构造 URL。
    function resolveApiUrl(url) {
        if (url.indexOf('/rs') === 0 || url.indexOf('/minio') === 0) return url;
        return '/minio/api' + url;
    }

    function apiRequest(method, url, data, callback) {
        var xhr = new XMLHttpRequest();
        var isRs = url.indexOf('/rs') === 0;
        var fullUrl = resolveApiUrl(url);
        xhr.open(method, fullUrl, true);
        xhr.setRequestHeader('Content-Type', 'application/json;charset=UTF-8');
        xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
        xhr.timeout = 60000;
        xhr.onreadystatechange = function() {
            if (xhr.readyState === 4) {
                try {
                    var resp = JSON.parse(xhr.responseText);
                    if (xhr.status === 401 && fullUrl.indexOf('/rs/auth/login') !== 0) {
                        // token 缺失/过期 → 弹出登录页
                        showLoginOverlay('登录已过期，请重新登录');
                    }
                    if (xhr.status >= 400) {
                        callback(resp.error || ('HTTP ' + xhr.status), null);
                    } else if (isRs) {
                        // RS 模块返回 {ok, data}，提取 data 层
                        if (resp.ok === false) callback(resp.error || '请求失败', null);
                        else callback(null, resp.data !== undefined ? resp.data : resp);
                    } else {
                        // 原有 MinIO 模块保持旧逻辑
                        callback(null, resp);
                    }
                } catch(e) { callback('JSON parse error', null); }
            }
        };
        xhr.onerror = function() { callback('Network error', null); };
        xhr.ontimeout = function() { callback('Request timeout', null); };
        if (data) xhr.send(JSON.stringify(data)); else xhr.send();
    }

    // =================== Modal 统一开关 ===================
    // 所有 modal-backdrop 的打开/关闭一律走这两个函数，禁止散落 style.display 操作
    function openModal(id) {
        var m = document.getElementById(id);
        if (m) m.style.display = 'flex';
    }
    function closeModal(id) {
        var m = document.getElementById(id);
        if (m) m.style.display = 'none';
    }
    // ESC 关闭最上层打开的 modal
    document.addEventListener('keydown', function(e) {
        if (e.key !== 'Escape') return;
        var modals = document.querySelectorAll('.modal-backdrop');
        for (var i = modals.length - 1; i >= 0; i--) {
            if (modals[i].style.display === 'flex') { modals[i].style.display = 'none'; break; }
        }
    });

    // =================== Utility ===================
    function escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    function escapeAttr(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\\/g, '&#92;');
    }

    function formatSize(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        var k = 1024;
        var sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        var i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function fileBasename(path) {
        if (!path) return '';
        var parts = path.replace(/\/+$/, '').split('/');
        return parts[parts.length - 1] || '';
    }

    function getFileIcon(filename) {
        if (!filename) return '&#128196;';
        var ext = filename.split('.').pop().toLowerCase();
        var map = {
            'pdf': '&#128230;', 'doc': '&#128196;', 'docx': '&#128196;',
            'xls': '&#128202;', 'xlsx': '&#128202;', 'csv': '&#128202;',
            'jpg': '&#127748;', 'jpeg': '&#127748;', 'png': '&#127748;', 'gif': '&#127748;', 'bmp': '&#127748;', 'svg': '&#127748;',
            'mp4': '&#127916;', 'avi': '&#127916;', 'mkv': '&#127916;', 'mov': '&#127916;',
            'mp3': '&#127925;', 'wav': '&#127925;', 'flac': '&#127925;',
            'zip': '&#128230;', 'rar': '&#128230;', '7z': '&#128230;', 'tar': '&#128230;', 'gz': '&#128230;',
            'txt': '&#128196;', 'md': '&#128196;',
            'js': '&#128187;', 'py': '&#128187;', 'java': '&#128187;', 'html': '&#128187;', 'css': '&#128187;'
        };
        return map[ext] || '&#128196;';
    }

    // =================== Toast Notification ===================
    function showToast(type, message) {
        var container = document.getElementById('toastContainer');
        var toast = document.createElement('div');
        toast.className = 'toast ' + type;
        var icons = { success: '&#10003;', error: '&#10007;', info: '&#8505;' };
        toast.innerHTML = '<span>' + (icons[type] || '') + '</span><span>' + escapeHtml(message) + '</span>';
        container.appendChild(toast);
        setTimeout(function() {
            toast.style.animation = 'toastIn .3s ease reverse';
            setTimeout(function() { toast.remove(); }, 300);
        }, 3000);
    }
    // Keep showAlert for backward compatibility but redirect to toast
    function showAlert(type, message) {
        showToast(type, message);
    }

    // =================== Connection Status ===================
    function updateConnectionStatus(connected) {
        var dot = document.getElementById('statusDot');
        var text = document.getElementById('statusText');
        dot.classList.toggle('connected', connected);
        text.textContent = connected ? '已连接' : '未连接';
    }

    // =================== Config ===================
    function getConfigFromForm() {
        var ulInput = document.getElementById('uploadSizeLimit');
        var ulVal = 512;
        if (ulInput && ulInput.value.trim() !== '') {
            var n = parseInt(ulInput.value, 10);
            if (!isNaN(n) && n >= 0) ulVal = n;
        }
        return {
            server_address: document.getElementById('serverAddress').value.trim(),
            access_key: document.getElementById('accessKey').value.trim(),
            secret_key: document.getElementById('secretKey').value.trim(),
            upload_size_limit: ulVal
        };
    }

    function enableKeyEdit(btn) {
        var targetId = btn.getAttribute('data-target');
        var input = document.getElementById(targetId);
        input.removeAttribute('readonly');
        input.value = '';
        input.focus();
        btn.style.display = 'none';
    }

    function saveConfig() {
        var config = getConfigFromForm();
        if (!config.server_address) {
            showAlert('error', '请填写服务器地址');
            return;
        }
        // access_key / secret_key 空值时后端自动保留旧值
        apiRequest('POST', '/config', config, function(err, resp) {
            if (err) { showAlert('error', '连接失败: ' + err); updateConnectionStatus(false); }
            else {
                showAlert('success', resp.message || '连接成功！');
                updateConnectionStatus(true);
                refreshBuckets();
                // 保存成功后恢复 mask 状态
                maskKeyField('accessKey', 'akBadge');
                maskKeyField('secretKey', 'skBadge');
            }
        });
    }

    function maskKeyField(inputId, badgeId) {
        var input = document.getElementById(inputId);
        var badge = document.getElementById(badgeId);
        input.setAttribute('readonly', 'readonly');
        input.value = '';
        input.placeholder = '******** (已配置, 点击✎编辑)';
        badge.style.display = '';
        var editBtn = document.querySelector('.mask-edit-btn[data-target="' + inputId + '"]');
        if (editBtn) editBtn.style.display = '';
    }

    function testConnection() { saveConfig(); }

    function updateUploadLimitDisplay(limitMB) {
        var el = document.getElementById('uploadLimitDisplay');
        if (!el) return;
        var n = parseInt(limitMB, 10);
        if (isNaN(n) || n <= 0) {
            el.textContent = '不限制';
            el.classList.add('no-limit');
        } else if (n >= 1024) {
            el.textContent = (n / 1024).toFixed(1) + ' GB (' + n + ' MB)';
            el.classList.remove('no-limit');
        } else {
            el.textContent = n + ' MB';
            el.classList.remove('no-limit');
        }
    }

    // =================== Load Config ===================
    function loadConfig() {
        apiRequest('GET', '/config', null, function(err, resp) {
            if (err) return;
            document.getElementById('serverAddress').value = resp.server_address || '';
            // key 字段前端不展示明文, 仅显示 "已配置" 状态 + mask
            if (resp.access_key_set) maskKeyField('accessKey', 'akBadge');
            else document.getElementById('akBadge').style.display = 'none';
            if (resp.secret_key_set) maskKeyField('secretKey', 'skBadge');
            else document.getElementById('skBadge').style.display = 'none';
            // 回填上传大小限制
            var ul = document.getElementById('uploadSizeLimit');
            if (ul) ul.value = (resp.upload_size_limit != null) ? resp.upload_size_limit : 512;
            // 更新上传页底部显示
            updateUploadLimitDisplay(resp.upload_size_limit);
            updateConnectionStatus(resp.connected || false);
            if (resp.connected) refreshBuckets();
        });
    }

    // =================== Buckets ===================
    function refreshBuckets() {
        apiRequest('GET', '/buckets', null, function(err, resp) {
            if (err) return;
            var buckets = resp.buckets || [];
            var html = buckets.map(function(b) {
                return '<div style="padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius);margin-bottom:6px;cursor:pointer" onclick="this.style.background=\'#f0f6ff\'">' +
                    '<strong>' + escapeHtml(b.name) + '</strong> <span style="color:var(--text-secondary);font-size:.8rem">' + (b.creation_date || '') + '</span></div>';
            }).join('');
            document.getElementById('bucketsList').innerHTML = html || '<p style="color:var(--text-secondary)">无桶</p>';
            document.getElementById('bucketsCard').style.display = 'block';
            // Update bucket dropdowns
            var options = '<option value="">-- 选择桶 --</option>';
            buckets.forEach(function(b) { options += '<option value="' + escapeAttr(b.name) + '">' + escapeHtml(b.name) + '</option>'; });
            document.getElementById('uploadBucket').innerHTML = options;
            document.getElementById('downloadBucket').innerHTML = options;
            // Restore last selections
            var lastUpload = localStorage.getItem('last_upload_bucket');
            var lastDownload = localStorage.getItem('last_download_bucket');
            if (lastUpload && buckets.find(function(b) { return b.name === lastUpload; }))
                document.getElementById('uploadBucket').value = lastUpload;
            if (lastDownload && buckets.find(function(b) { return b.name === lastDownload; })) {
                document.getElementById('downloadBucket').value = lastDownload;
            }
        });
    }

    // =================== Upload ===================
    function onUploadBucketChange() {
        var bucket = document.getElementById('uploadBucket').value;
        localStorage.setItem('last_upload_bucket', bucket);
        uploadCurrentPrefix = localStorage.getItem('upload_prefix') || '';
        updateUploadPathBar();
        if (bucket) {
            openUploadFolderBrowser();
        } else {
            document.getElementById('uploadFolderBrowser').classList.add('hidden');
        }
    }

    function updateUploadPathBar() {
        var bucket = document.getElementById('uploadBucket').value;
        var path = uploadCurrentPrefix || '';
        var full = bucket ? (bucket + (path ? '/' + path : '')) : '';
        var bar = document.getElementById('uploadPathBar');
        bar.setAttribute('data-full-path', full);
        var b = bar.querySelector('b');
        b.textContent = full || '未选择桶';
        b.title = full ? '双击复制路径: ' + full : '';
        b.ondblclick = function() { copyCurrentPath('uploadPathBar'); };
    }

    function openUploadFolderBrowser() {
        document.getElementById('uploadFolderBrowser').classList.remove('hidden');
        loadUploadFolders();
    }

    function loadUploadFolders() {
        var bucket = document.getElementById('uploadBucket').value;
        if (!bucket) return;
        var prefix = uploadCurrentPrefix || '';
        apiRequest('GET', '/folders?bucket=' + encodeURIComponent(bucket) + '&prefix=' + encodeURIComponent(prefix), null, function(err, resp) {
            if (err) { showAlert('error', err); return; }
            renderUploadFolders(resp.folders || [], bucket, prefix);
        });
    }

    function renderUploadFolders(folders, bucket, prefix) {
        // Breadcrumb
        var parts = prefix ? prefix.split('/').filter(Boolean) : [];
        var bcHtml = '<span class="breadcrumb-item ' + (parts.length === 0 ? 'active' : '') + '" onclick="navigateUploadBreadcrumb(undefined)">' + escapeHtml(bucket) + '</span>';
        parts.forEach(function(p, i) {
            var path = parts.slice(0, i + 1).join('/');
            var isLast = (i === parts.length - 1);
            bcHtml += '<span class="breadcrumb-sep">/</span>';
            bcHtml += '<span class="breadcrumb-item ' + (isLast ? 'active' : '') + '" onclick="navigateUploadBreadcrumb(\'' + escapeAttr(path) + '\')">' + escapeHtml(p) + '</span>';
        });
        document.getElementById('uploadBreadcrumb').innerHTML = bcHtml;
        // Grid
        var gridHtml = folders.map(function(f) {
            return '<div class="folder-card" data-folder="' + escapeAttr(f) + '">' +
                '<span class="folder-icon">' + FOLDER_SVG + '</span>' + escapeHtml(fileBasename(f)) + '</div>';
        }).join('');
        document.getElementById('uploadFolderGrid').innerHTML = gridHtml || '<p style="color:var(--text-secondary);font-size:.85rem">无子文件夹</p>';
        // Click handler
        document.querySelectorAll('#uploadFolderGrid .folder-card').forEach(function(card) {
            card.addEventListener('click', function() {
                var folder = this.getAttribute('data-folder');
                enterUploadFolder(folder);
            });
        });
    }

    function enterUploadFolder(folder) {
        uploadCurrentPrefix = folder.replace(/\/+$/, '');
        localStorage.setItem('upload_prefix', uploadCurrentPrefix);
        updateUploadPathBar();
        loadUploadFolders();
    }

    function navigateUploadBreadcrumb(path) {
        uploadCurrentPrefix = path || '';
        localStorage.setItem('upload_prefix', uploadCurrentPrefix || '');
        updateUploadPathBar();
        loadUploadFolders();
    }

    // =================== Multi-File Upload ===================

    // 全局阻止浏览器对拖拽文件的默认行为 (避免打开新页面)
    ['dragenter', 'dragover', 'drop'].forEach(function(evtName) {
        document.addEventListener(evtName, function(e) {
            if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.indexOf('Files') !== -1) {
                e.preventDefault();
                e.stopPropagation();
            }
        }, false);
    });

    function bindDropZone() {
        var zone = document.getElementById('uploadZone');
        if (!zone) return;
        var leaveTimer = null;

        function hasFiles(e) {
            return e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.indexOf('Files') !== -1;
        }

        zone.addEventListener('dragenter', function(e) {
            if (!hasFiles(e)) return;
            e.preventDefault();
            e.stopPropagation();
            zone.classList.add('drag-over');
            if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
        });

        zone.addEventListener('dragover', function(e) {
            if (!hasFiles(e)) return;
            e.preventDefault();
            e.stopPropagation();
            zone.classList.add('drag-over');
        });

        zone.addEventListener('dragleave', function(e) {
            // 子元素之间切换也会触发, 用 timer 去抖
            leaveTimer = setTimeout(function() { zone.classList.remove('drag-over'); }, 80);
        });

        zone.addEventListener('drop', function(e) {
            e.preventDefault();
            e.stopPropagation();
            zone.classList.remove('drag-over');
            if (!hasFiles(e)) return;
            var dropped = Array.from(e.dataTransfer.files);
            if (!dropped.length) return;
            var bucket = document.getElementById('uploadBucket').value;
            if (!bucket) { showAlert('error', '请先选择目标桶'); return; }
            uploadFiles = uploadFiles.concat(dropped);
            renderUploadFileList();
            showToast('success', '已添加 ' + dropped.length + ' 个文件到上传列表');
        });
    }

    function handleMultiFileSelect(input) {
        var files = Array.from(input.files);
        if (!files.length) return;
        var bucket = document.getElementById('uploadBucket').value;
        if (!bucket) { showAlert('error', '请先选择目标桶'); input.value = ''; return; }
        uploadFiles = uploadFiles.concat(files);
        renderUploadFileList();
        input.value = '';
    }

    function renderUploadFileList() {
        var container = document.getElementById('uploadFileList');
        var items = document.getElementById('uploadFileItems');
        document.getElementById('uploadFileCount').textContent = uploadFiles.length;
        if (uploadFiles.length === 0) {
            container.classList.add('hidden');
            return;
        }
        container.classList.remove('hidden');
        items.innerHTML = uploadFiles.map(function(f, i) {
            return '<div class="upload-file-item">' +
                '<span class="file-info"><span class="file-name">' + escapeHtml(f.name) + '</span></span>' +
                '<span class="file-size">' + formatSize(f.size) + '</span>' +
                '<span class="remove-btn" onclick="removeUploadFile(' + i + ')">&times;</span></div>';
        }).join('');
    }

    function removeUploadFile(idx) {
        uploadFiles.splice(idx, 1);
        renderUploadFileList();
    }

    function clearUploadList() {
        uploadFiles = [];
        renderUploadFileList();
        document.getElementById('uploadProgress').style.display = 'none';
        hideBottomProgress();
    }

    // =================== Bottom Progress ===================
    function showBottomProgress(text, percent) {
        var progress = document.getElementById('bottomProgress');
        progress.classList.add('show');
        document.getElementById('progressText').textContent = text;
        document.getElementById('progressPercent').textContent = percent + '%';
        document.getElementById('bottomProgressBar').style.width = percent + '%';
    }

    function hideBottomProgress() {
        document.getElementById('bottomProgress').classList.remove('show');
        document.getElementById('cancelProgressBtn').style.display = 'none';
    }

    function showCancelBtn() {
        document.getElementById('cancelProgressBtn').style.display = 'inline-flex';
    }

    function cancelCurrentTransfer() {
        if (currentTransferType === 'upload' && currentUploadXhr) {
            currentUploadXhr.abort();
            currentUploadXhr = null;
            showToast('error', '上传已取消');
            hideBottomProgress();
            document.getElementById('batchUploadBtn').disabled = false;
        } else if (currentTransferType === 'download' && currentDownloadXhr) {
            currentDownloadXhr.abort();
            currentDownloadXhr = null;
            showToast('error', '下载已取消');
            hideBottomProgress();
        }
        currentTransferType = null;
    }

    function updateBottomProgress(text, percent) {
        showBottomProgress(text, percent);
    }

    function batchUpload() {
        if (!uploadFiles.length) { showAlert('error', '请先选择文件'); return; }
        var bucket = document.getElementById('uploadBucket').value;
        if (!bucket) { showAlert('error', '请先选择目标桶'); return; }
        document.getElementById('batchUploadBtn').disabled = true;
        showBottomProgress('准备上传...', 0);
        var currentFile = 0;
        var prefix = uploadCurrentPrefix || '';

        function uploadNext() {
            if (currentFile >= uploadFiles.length) {
                showBottomProgress('上传完成！', 100);
                showAlert('success', '全部文件上传成功！');
                document.getElementById('batchUploadBtn').disabled = false;
                setTimeout(function() { hideBottomProgress(); }, 2000);
                return;
            }
            var file = uploadFiles[currentFile];
            var pct = Math.round((currentFile / uploadFiles.length) * 100);
            showBottomProgress('上传中: ' + file.name + ' (' + (currentFile + 1) + '/' + uploadFiles.length + ')', pct);

            var formData = new FormData();
            formData.append('file', file);
            formData.append('bucket', bucket);
            formData.append('upload_id', 'upload-' + Date.now());
            var uploadPath = prefix ? prefix + '/' + file.name : file.name;
            formData.append('custom_name', uploadPath);

            var xhr = new XMLHttpRequest();
            currentUploadXhr = xhr;
            currentTransferType = 'upload';
            showCancelBtn();
            xhr.open('POST', resolveApiUrl('/upload'), true);
            var serverConfirmed = false;
            xhr.upload.addEventListener('progress', function(e) {
                if (e.lengthComputable && !serverConfirmed) {
                    var filePct = Math.round((e.loaded / e.total) * 100);
                    // 客户端传输完成但服务端未响应时, 卡在上限 99%, 显示 "服务端处理中..."
                    var effectivePct = Math.min(filePct, 99);
                    var totalPct = Math.round(((currentFile + effectivePct / 100) / uploadFiles.length) * 100);
                    var statusText = '上传中: ' + file.name + ' (' + (currentFile + 1) + '/' + uploadFiles.length + ') ' + filePct + '%';
                    if (filePct >= 100) statusText += ' — 服务端处理中...';
                    showBottomProgress(statusText, totalPct);
                }
            });
            xhr.onreadystatechange = function() {
                if (xhr.readyState === 4) {
                    currentUploadXhr = null;
                    currentTransferType = null;
                    if (xhr.status === 0 && xhr.responseText === '') {
                        // Aborted (user cancelled)
                        return;
                    }
                    try {
                        var resp = JSON.parse(xhr.responseText);
                        if (xhr.status === 200) {
                            serverConfirmed = true;
                            currentFile++;
                            uploadNext();
                        } else {
                            showAlert('error', '上传失败: ' + (resp.error || '未知错误'));
                            document.getElementById('batchUploadBtn').disabled = false;
                            hideBottomProgress();
                        }
                    } catch(e) {
                        showAlert('error', '上传失败: ' + e.message);
                        document.getElementById('batchUploadBtn').disabled = false;
                        hideBottomProgress();
                    }
                }
            };
            xhr.send(formData);
        }
        uploadNext();
    }

    function updateUploadProgress(current, total, percent) {
        document.getElementById('uploadProgressText').textContent = '上传 ' + current + '/' + total;
        document.getElementById('uploadProgressPercent').textContent = percent + '%';
        document.getElementById('uploadProgressBar').style.width = percent + '%';
        document.getElementById('uploadProgressBar').textContent = percent + '%';
    }

    // =================== Download ===================
    function onDownloadBucketChange() {
        var bucket = document.getElementById('downloadBucket').value;
        localStorage.setItem('last_download_bucket', bucket);
        downloadCurrentPrefix = '';
        localStorage.removeItem('download_prefix');
        downloadCurrentSearch = '';
        currentDownloadPage = 1;
        updateDownloadPathBar();
        document.getElementById('downloadPagination').style.display = 'none';
        document.getElementById('downloadFileListArea').innerHTML = '<div class="empty-state"><div class="empty-icon">&#128194;</div><p>选择桶后点击查询查看文件列表</p></div>';
        document.getElementById('downloadSelectAllBar').classList.add('hidden');
        allDownloadFiles = [];
        selectedDownloadFiles = {};
        if (bucket) {
            openDownloadFolderBrowser();
        } else {
            document.getElementById('downloadFolderBrowser').classList.add('hidden');
        }
    }

    function updateDownloadPathBar() {
        var bucket = document.getElementById('downloadBucket').value;
        var path = downloadCurrentPrefix || '';
        var full = bucket ? (bucket + (path ? '/' + path : '')) : '';
        var bar = document.getElementById('downloadPathBar');
        bar.setAttribute('data-full-path', full);
        var b = bar.querySelector('b');
        b.textContent = full || '未选择桶';
        b.title = full ? '双击复制路径: ' + full : '';
        b.ondblclick = function() { copyCurrentPath('downloadPathBar'); };
    }

    function openDownloadFolderBrowser() {
        document.getElementById('downloadFolderBrowser').classList.remove('hidden');
        loadDownloadFolders();
    }

    function loadDownloadFolders() {
        var bucket = document.getElementById('downloadBucket').value;
        if (!bucket) return;
        var prefix = downloadCurrentPrefix || '';
        apiRequest('GET', '/folders?bucket=' + encodeURIComponent(bucket) + '&prefix=' + encodeURIComponent(prefix), null, function(err, resp) {
            if (err) { showAlert('error', err); return; }
            renderDownloadFolders(resp.folders || [], bucket, prefix);
        });
    }

    function renderDownloadFolders(folders, bucket, prefix) {
        var parts = prefix ? prefix.split('/').filter(Boolean) : [];
        var bcHtml = '<span class="breadcrumb-item ' + (parts.length === 0 ? 'active' : '') + '" onclick="navigateDownloadBreadcrumb(undefined)">' + escapeHtml(bucket) + '</span>';
        parts.forEach(function(p, i) {
            var path = parts.slice(0, i + 1).join('/');
            var isLast = (i === parts.length - 1);
            bcHtml += '<span class="breadcrumb-sep">/</span>';
            bcHtml += '<span class="breadcrumb-item ' + (isLast ? 'active' : '') + '" onclick="navigateDownloadBreadcrumb(\'' + escapeAttr(path) + '\')">' + escapeHtml(p) + '</span>';
        });
        document.getElementById('downloadBreadcrumb').innerHTML = bcHtml;
        var gridHtml = folders.map(function(f) {
            return '<div class="folder-card" data-folder="' + escapeAttr(f) + '">' +
                '<span class="folder-icon">' + FOLDER_SVG + '</span>' + escapeHtml(fileBasename(f)) + '</div>';
        }).join('');
        document.getElementById('downloadFolderGrid').innerHTML = gridHtml || '<p style="color:var(--text-secondary);font-size:.85rem">无子文件夹</p>';
        document.querySelectorAll('#downloadFolderGrid .folder-card').forEach(function(card) {
            card.addEventListener('click', function() {
                var folder = this.getAttribute('data-folder');
                enterDownloadFolder(folder);
            });
        });
    }

    function enterDownloadFolder(folder) {
        downloadCurrentPrefix = folder.replace(/\/+$/, '');
        localStorage.setItem('download_prefix', downloadCurrentPrefix);
        updateDownloadPathBar();
        loadDownloadFolders();
    }

    function navigateDownloadBreadcrumb(path) {
        downloadCurrentPrefix = path || '';
        localStorage.setItem('download_prefix', downloadCurrentPrefix || '');
        updateDownloadPathBar();
        loadDownloadFolders();
    }

    function setDownloadSearchType(type) {
        currentDownloadSearchType = type;
        document.querySelectorAll('.search-type-btn').forEach(function(btn) {
            btn.classList.toggle('active', btn.getAttribute('data-type') === type);
        });
    }

    // =================== Load Download Files ===================
    function loadDownloadFiles() {
        var bucket = document.getElementById('downloadBucket').value;
        if (!bucket) { showAlert('error', '请先选择桶'); return; }
        var searchInput = document.getElementById('downloadSearchInput');
        var pattern = searchInput ? searchInput.value.trim() : '';
        var prefix = downloadCurrentPrefix;
        downloadCurrentSearch = pattern;
        updateDownloadPathBar();
        currentDownloadPage = 1;
        var hasSearch = !!pattern;
        var query = '?bucket=' + encodeURIComponent(bucket);
        if (prefix) query += '&prefix=' + encodeURIComponent(prefix);
        query += '&offset=' + ((currentDownloadPage - 1) * downloadPageSize);
        query += '&limit=' + downloadPageSize;
        document.getElementById('downloadFileListArea').innerHTML = '<div class="empty-state"><div class="spinner"></div><p style="margin-top:12px">加载中...</p></div>';
        document.getElementById('downloadPagination').style.display = 'none';
        var url;
        if (hasSearch) {
            query = '?bucket=' + encodeURIComponent(bucket) + '&pattern=' + encodeURIComponent(pattern) + '&type=' + currentDownloadSearchType;
            if (prefix) query += '&prefix=' + encodeURIComponent(prefix);
            url = '/search' + query;
        } else {
            url = '/files' + query;
        }
        apiRequest('GET', url, null, function(err, resp) {
            if (err) {
                showAlert('error', '获取文件列表失败: ' + err);
                document.getElementById('downloadFileListArea').innerHTML = '<div class="empty-state"><div class="empty-icon">&#9888;</div><p>加载失败</p></div>';
                document.getElementById('downloadSelectAllBar').classList.add('hidden');
                allDownloadFiles = []; selectedDownloadFiles = {};
                return;
            }
            allDownloadFiles = resp.files || [];
            selectedDownloadFiles = {};
            downloadCurrentTotal = resp.total_collected || allDownloadFiles.length;
            if (allDownloadFiles.length === 0) {
                document.getElementById('downloadFileListArea').innerHTML = '<div class="empty-state"><div class="empty-icon">&#128194;</div><p>该目录暂无文件</p></div>';
                document.getElementById('downloadSelectAllBar').classList.add('hidden');
                document.getElementById('downloadPagination').style.display = 'none';
                return;
            }
            totalDownloadPages = Math.max(1, Math.ceil(downloadCurrentTotal / downloadPageSize));
            document.getElementById('downloadSelectAllBar').classList.remove('hidden');
            renderDownloadFileTable(allDownloadFiles, bucket);
            renderPagination();
        });
    }

    // =================== Pagination ===================
    function onDownloadPageSizeChange() {
        downloadPageSize = parseInt(document.getElementById('downloadPageSize').value, 10);
        currentDownloadPage = 1;
        loadDownloadFiles();
    }

    function goDownloadPage(page) {
        if (page < 1 || page > totalDownloadPages) return;
        currentDownloadPage = page;
        loadDownloadFiles();
    }

    function renderPagination() {
        var pagination = document.getElementById('downloadPagination');
        if (totalDownloadPages <= 1) { pagination.style.display = 'none'; return; }
        pagination.style.display = 'flex';
        var start = (currentDownloadPage - 1) * downloadPageSize + 1;
        var end = Math.min(currentDownloadPage * downloadPageSize, downloadCurrentTotal);
        document.getElementById('downloadPaginationInfo').textContent = '显示 ' + start + '-' + end + ' / 共 ' + downloadCurrentTotal + ' 条';
        document.getElementById('downloadPageNum').textContent = currentDownloadPage + ' / ' + totalDownloadPages;
        document.getElementById('downloadPageFirst').disabled = (currentDownloadPage <= 1);
        document.getElementById('downloadPagePrev').disabled = (currentDownloadPage <= 1);
        document.getElementById('downloadPageNext').disabled = (currentDownloadPage >= totalDownloadPages);
        document.getElementById('downloadPageLast').disabled = (currentDownloadPage >= totalDownloadPages);
    }

    // =================== Download File Table ===================
    function renderDownloadFileTable(files, bucket) {
        var html = '<div class="table-responsive"><table class="file-table"><thead><tr>' +
            '<th><input type="checkbox" class="file-checkbox" onchange="toggleDownloadSelectAll()"></th>' +
            '<th>文件名</th><th>大小</th><th>修改时间</th><th>操作</th></tr></thead><tbody>';
        files.forEach(function(f, idx) {
            var basename = fileBasename(f.name);
            var icon = getFileIcon(basename);
            var escapedFull = escapeHtml(f.name);
            var escapedBase = escapeHtml(basename);
            var isFolder = f.name.endsWith('/');
            html += '<tr>' +
                '<td><input type="checkbox" class="file-checkbox" data-idx="' + idx + '" onchange="toggleDownloadFileSelectByIdx(this)"></td>' +
                '<td><div class="file-name"><span class="file-icon">' + icon + '</span>' +
                '<span class="name-text" title="' + escapedFull + ' (双击复制)"><span class="copy-trigger">' + escapedBase + '</span></span></div></td>' +
                '<td>' + formatSize(f.size) + '</td>' +
                '<td>' + escapeHtml(f.last_modified || '') + '</td>' +
                '<td class="actions"><div class="btn-group">' +
                '<button class="btn btn-sm btn-primary download-btn" data-idx="' + idx + '">⬇ 下载</button>' +
                '<button class="btn btn-sm btn-danger delete-btn" data-idx="' + idx + '">🗑 删除</button>' +
                '</div></td></tr>';
        });
        html += '</tbody></table></div>';
        document.getElementById('downloadFileListArea').innerHTML = html;
        // Event delegation
        document.querySelectorAll('.copy-trigger').forEach(function(el) {
            el.addEventListener('dblclick', function() {
                var row = this.closest('tr');
                var idx = parseInt(row.querySelector('[data-idx]').getAttribute('data-idx'), 10);
                copyFileNameByIdx(idx);
            });
        });
        document.querySelectorAll('.delete-btn').forEach(function(el) {
            el.addEventListener('click', function() {
                var idx = parseInt(this.getAttribute('data-idx'), 10);
                deleteFileByIdx(idx, bucket);
            });
        });
        document.querySelectorAll('.download-btn').forEach(function(el) {
            el.addEventListener('click', function() {
                var idx = parseInt(this.getAttribute('data-idx'), 10);
                downloadFileByIdx(idx, bucket);
            });
        });
        updateDownloadSelectAllState();
    }

    // =================== Download Selection ===================
    function toggleDownloadFileSelectByIdx(checkbox) {
        var idx = parseInt(checkbox.getAttribute('data-idx'), 10);
        var name = allDownloadFiles[idx].name;
        if (checkbox.checked) selectedDownloadFiles[name] = true;
        else delete selectedDownloadFiles[name];
        updateDownloadSelectedCount();
        updateDownloadSelectAllState();
    }

    function copyCurrentPath(barId) {
        var bar = document.getElementById(barId);
        var path = bar.getAttribute('data-full-path') || '';
        if (!path) { showAlert('error', '还未选择桶或路径'); return; }
        copyFileName(path);
    }

    function copyFileNameByIdx(idx) {
        var basename = fileBasename(allDownloadFiles[idx].name);
        copyFileName(basename);
    }

    function downloadFileByIdx(idx, bucket) {
        downloadFile(bucket, allDownloadFiles[idx].name);
    }

    function deleteFileByIdx(idx, bucket) {
        deleteFile(bucket, allDownloadFiles[idx].name);
    }

    function toggleDownloadSelectAll() {
        var toolbarCb = document.getElementById('downloadSelectAllCheckbox');
        var tableCb = document.querySelector('#downloadFileListArea .file-table th .file-checkbox');
        var isChecked = false;
        if (toolbarCb && tableCb) {
            isChecked = !toolbarCb.checked;
            toolbarCb.checked = isChecked;
            tableCb.checked = isChecked;
        }
        document.querySelectorAll('#downloadFileListArea .file-checkbox[data-idx]').forEach(function(cb) {
            cb.checked = isChecked;
            var idx = parseInt(cb.getAttribute('data-idx'), 10);
            var name = allDownloadFiles[idx].name;
            if (isChecked) selectedDownloadFiles[name] = true;
            else delete selectedDownloadFiles[name];
        });
        updateDownloadSelectedCount();
    }

    function updateDownloadSelectedCount() {
        document.getElementById('downloadSelectedCount').textContent = '已选择 ' + Object.keys(selectedDownloadFiles).length + ' 个文件';
    }

    function updateDownloadSelectAllState() {
        var checkboxes = document.querySelectorAll('#downloadFileListArea .file-checkbox[data-idx]');
        var checkedCount = Array.from(checkboxes).filter(function(cb) { return cb.checked; }).length;
        var allCount = checkboxes.length;
        var tableCb = document.querySelector('#downloadFileListArea .file-table th .file-checkbox');
        var toolbarCb = document.getElementById('downloadSelectAllCheckbox');
        if (tableCb) tableCb.indeterminate = checkedCount > 0 && checkedCount < allCount;
        if (tableCb) tableCb.checked = allCount > 0 && checkedCount === allCount;
        if (toolbarCb) toolbarCb.checked = allCount > 0 && checkedCount === allCount;
    }

    // =================== File Operations ===================
    function hasInAppApi() {
        return !!(window.pywebview && window.pywebview.api && window.pywebview.api.download);
    }

    function copyFileName(name) {
        function fallbackCopy() {
            var ta = document.createElement('textarea');
            ta.value = name;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            var ok = false;
            try { ok = document.execCommand('copy'); } catch (e) {}
            document.body.removeChild(ta);
            return ok;
        }
        function finish(ok) {
            if (ok) showAlert('success', '已复制: ' + name);
            else showAlert('error', '复制失败，请手动选择复制');
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(name).then(
                function() { finish(true); },
                function() { finish(fallbackCopy()); }
            );
        } else {
            finish(fallbackCopy());
        }
    }

    function downloadFile(bucket, objectName) {
        var basename = fileBasename(objectName);
        if (hasInAppApi()) {
            // 桌面版: 弹出原生 SAVE 对话框选择本地路径
            showBottomProgress('正在下载: ' + basename + ' (请在弹出的保存对话框中选择位置)', 0);
            var apiCall = window.pywebview.api.download(bucket, objectName, "single_" + Date.now());
            // pywebview 4.x 返回 Promise, 3.x 可能返回 dict 直接
            Promise.resolve(apiCall).then(function(result) {
                currentDownloadXhr = null;
                currentTransferType = null;
                if (result && result.status === "ok") {
                    showBottomProgress('下载完成: ' + basename, 100);
                    setTimeout(function() { hideBottomProgress(); }, 1500);
                } else if (result && result.status === "cancelled") {
                    hideBottomProgress();
                    showToast('info', '已取消下载');
                } else {
                    hideBottomProgress();
                    showToast('error', '下载失败: ' + (result && result.message ? result.message : '未知错误'));
                }
            }).catch(function(err) {
                currentDownloadXhr = null;
                currentTransferType = null;
                hideBottomProgress();
                showToast('error', '下载失败: ' + (err && err.message ? err.message : String(err)));
            });
        } else {
            // 浏览器/开发模式 fallback
            showBottomProgress('正在下载 (浏览器模式): ' + basename, 0);
            var url = resolveApiUrl('/download?bucket=' + encodeURIComponent(bucket) + '&object_name=' + encodeURIComponent(objectName));
            fetch(url).then(function(resp) {
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                var reader = resp.body.getReader();
                var chunks = [];
                function read() {
                    reader.read().then(function(r) {
                        if (r.done) {
                            var blob = new Blob(chunks);
                            var a = document.createElement('a');
                            a.href = URL.createObjectURL(blob);
                            a.download = basename;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            hideBottomProgress();
                            showToast('success', '下载完成');
                            return;
                        }
                        chunks.push(r.value);
                        read();
                    });
                }
                read();
            }).catch(function(err) {
                hideBottomProgress();
                showToast('error', '下载失败: ' + err.message);
            });
        }
    }

    function batchDownloadSelected() {
        var bucket = document.getElementById('downloadBucket').value;
        var names = Object.keys(selectedDownloadFiles);
        if (names.length === 0) { showAlert('error', '请先选择要下载的文件'); return; }
        if (hasInAppApi()) {
            // 桌面版: 弹出原生 FOLDER 对话框选择目标目录
            showBottomProgress('批量下载中 ' + names.length + ' 个文件 (请在弹出的对话框中选择保存目录)...', 0);
            var apiCall = window.pywebview.api.batch_download(bucket, names);
            Promise.resolve(apiCall).then(function(result) {
                if (result && result.status === "ok") {
                    showBottomProgress('批量下载完成: ' + result.count + ' 个文件', 100);
                    setTimeout(function() { hideBottomProgress(); }, 2000);
                } else if (result && result.status === "cancelled") {
                    hideBottomProgress();
                    showToast('info', '已取消批量下载');
                } else {
                    hideBottomProgress();
                    showToast('error', '批量下载失败: ' + (result && result.message ? result.message : '未知错误'));
                }
            }).catch(function(err) {
                hideBottomProgress();
                showToast('error', '批量下载失败: ' + (err && err.message ? err.message : String(err)));
            });
        } else {
            // 浏览器 fallback: 打包成 zip 下载
            showBottomProgress('正在打包下载 ' + names.length + ' 个文件...', 0);
            var filesParam = encodeURIComponent(names.join(','));
            var url = resolveApiUrl('/batch-download?bucket=' + encodeURIComponent(bucket) + '&files=' + filesParam);
            fetch(url).then(function(resp) {
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                var reader = resp.body.getReader();
                var chunks = [];
                function read() {
                    reader.read().then(function(r) {
                        if (r.done) {
                            var blob = new Blob(chunks);
                            var a = document.createElement('a');
                            a.href = URL.createObjectURL(blob);
                            a.download = 'minio-batch-' + Date.now() + '.zip';
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            hideBottomProgress();
                            showToast('success', '下载完成');
                            return;
                        }
                        chunks.push(r.value);
                        read();
                    });
                }
                read();
            }).catch(function(err) {
                hideBottomProgress();
                showToast('error', '批量下载失败: ' + err.message);
            });
        }
    }

    function deleteFile(bucket, objectName) {
        if (!confirm('确定删除文件 "' + fileBasename(objectName) + '"？')) return;
        apiRequest('POST', '/delete', { bucket: bucket, object_name: objectName }, function(err, resp) {
            if (err) { showAlert('error', '删除失败: ' + err); return; }
            showAlert('success', '文件已删除');
            loadDownloadFiles();
        });
    }

    function batchDeleteSelected() {
        var bucket = document.getElementById('downloadBucket').value;
        var names = Object.keys(selectedDownloadFiles);
        if (names.length === 0) { showAlert('error', '请先选择要删除的文件'); return; }
        if (!confirm('确定删除选中的 ' + names.length + ' 个文件吗？')) return;
        apiRequest('POST', '/delete-many', { bucket: bucket, objects: names }, function(err, resp) {
            if (err) { showAlert('error', '删除失败: ' + err); return; }
            showAlert('success', '已删除 ' + names.length + ' 个文件');
            selectedDownloadFiles = {};
            updateDownloadSelectedCount();
            loadDownloadFiles();
        });
    }

    // =================== Particle Background ===================
    (function() {
        var canvas = document.getElementById('particleCanvas');
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        var particles = [];
        var PARTICLE_COUNT = 60;

        function resize() {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        }
        resize();
        window.addEventListener('resize', resize);

        function Particle() {
            this.x = Math.random() * canvas.width;
            this.y = Math.random() * canvas.height;
            this.vx = (Math.random() - 0.5) * 0.3;
            this.vy = (Math.random() - 0.5) * 0.3;
            this.r = Math.random() * 1.5 + 0.5;
            this.alpha = Math.random() * 0.5 + 0.2;
            this.hue = Math.random() > 0.5 ? 180 : 280; // cyan or purple
        }

        function init() {
            particles = [];
            for (var i = 0; i < PARTICLE_COUNT; i++) particles.push(new Particle());
        }

        function draw() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            for (var i = 0; i < particles.length; i++) {
                var p = particles[i];
                p.x += p.vx;
                p.y += p.vy;
                if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
                if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fillStyle = 'hsla(' + p.hue + ', 100%, 70%, ' + p.alpha + ')';
                ctx.fill();
                // Connect nearby particles
                for (var j = i + 1; j < particles.length; j++) {
                    var q = particles[j];
                    var dx = p.x - q.x, dy = p.y - q.y;
                    var dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < 120) {
                        ctx.beginPath();
                        ctx.moveTo(p.x, p.y);
                        ctx.lineTo(q.x, q.y);
                        ctx.strokeStyle = 'hsla(180, 100%, 70%, ' + (0.08 * (1 - dist / 120)) + ')';
                        ctx.lineWidth = 0.5;
                        ctx.stroke();
                    }
                }
            }
            requestAnimationFrame(draw);
        }
        init();
        draw();
    })();

    // =================== Theme Toggle ===================
    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        try { localStorage.setItem('minio-theme', theme); } catch(e) {}
        var icon = document.getElementById('themeIcon');
        if (icon) icon.innerHTML = theme === 'dark' ? '&#127769;' : '&#9728;';
        var toggle = document.getElementById('themeToggle');
        if (toggle) toggle.title = theme === 'dark' ? '切换到白昼模式' : '切换到深色模式';
        var canvas = document.getElementById('particleCanvas');
        if (canvas) canvas.style.opacity = theme === 'dark' ? '1' : '0.25';
    }
    function toggleTheme() {
        var cur = document.documentElement.getAttribute('data-theme') || 'light';
        applyTheme(cur === 'dark' ? 'light' : 'dark');
    }
    // 同步脚本已经应用了主题, 这里只更新图标
    (function() {
        var cur = document.documentElement.getAttribute('data-theme') || 'light';
        var icon = document.getElementById('themeIcon');
        if (icon) icon.innerHTML = cur === 'dark' ? '&#127769;' : '&#9728;';
        var toggle = document.getElementById('themeToggle');
        if (toggle) toggle.title = cur === 'dark' ? '切换到白昼模式' : '切换到深色模式';
        var canvas = document.getElementById('particleCanvas');
        if (canvas) canvas.style.opacity = cur === 'dark' ? '1' : '0.25';
    })();

    // =================== Init ===================
    // Sidebar 默认折叠, 若用户上次展开则恢复
    (function() {
        var sidebar = document.getElementById('sidebar');
        var expanded = false;
        try { expanded = localStorage.getItem('ui_sidebar_expanded') === '1'; } catch(e) {}
        if (sidebar) sidebar.classList.toggle('expanded', expanded);
        var toggle = document.getElementById('sidebarToggle');
        if (toggle) {
            toggle.innerHTML = expanded ? '&#10094;' : '&#10095;';
            toggle.title = expanded ? '收缩' : '展开';
        }
        var progress = document.getElementById('bottomProgress');
        if (progress) progress.style.left = expanded ? '200px' : '56px';
    })();
    bindDropZone();
    loadConfig();

    // =================== AI Chat JS ===================
    var aiMessages = [];
    var aiProviders = [];
    var aiCurrentXhr = null;

    function switchPanel(name) {
        document.querySelectorAll('.panel').forEach(function(p){ p.classList.remove('active'); });
        var p = document.getElementById('panel-' + name);
        if (p) p.classList.add('active');
        document.querySelectorAll('.nav-item').forEach(function(n){
            n.classList.toggle('active', n.dataset.panel === name);
        });
        var titles = {config:'连接配置', upload:'文件上传', download:'文件下载', ai:'AI 助手', browser:'内置浏览器'};
        if (titles[name]) {
            document.getElementById('pageTitle').textContent = titles[name];
        } else {
            // 动态菜单面板：取导航项显示名
            var navLbl = document.querySelector('.nav-item[data-panel="' + name + '"] .nav-label');
            if (navLbl) document.getElementById('pageTitle').textContent = navLbl.textContent;
        }
        if (name === 'ai') { loadAiConfigStatus(); loadAiPresets(); }
        if (name === 'config') { loadAiConnFields(); }
        try { localStorage.setItem('ui_active_panel', name); } catch(e) {}
    }

    // 重写 nav-item onclick, 改为 switchPanel
    document.addEventListener('click', function(e){
        var ni = e.target.closest('.nav-item');
        if (ni && ni.dataset.panel) switchPanel(ni.dataset.panel);
    });

    // =================== 需求 1: 内置浏览器（iframe 多标签） ===================
    var browserTabs = [];      // [{id, title, url, iframe}]
    var browserActiveId = null;
    var browserSeq = 0;

    function normalizeUrl(u) {
        u = (u || '').trim();
        if (!u) return '';
        if (u.indexOf('/') === 0 || u.indexOf('#') === 0) return u;   // 站内相对路径
        if (!/^https?:\/\//i.test(u) && !/^file:\/\//i.test(u)) {
            if (u.indexOf('/') === 0) return 'file://' + u;           // 本地绝对路径
            u = (u.indexOf('.') > -1 && u.indexOf(' ') === -1) ? 'https://' + u : 'https://www.baidu.com/s?wd=' + encodeURIComponent(u);
        }
        return u;
    }

    function browserAddTab(url) {
        url = normalizeUrl(url || '');
        var id = 'bt' + (++browserSeq);
        var iframe = document.createElement('iframe');
        iframe.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;display:none;background:#fff;';
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals');
        iframe.src = url || 'about:blank';
        var host = document.getElementById('panel-browser').querySelector('div[style*="position:relative"]');
        host.appendChild(iframe);
        var tab = {id: id, title: url ? hostTitleOf(url) : '新标签页', url: url, iframe: iframe, overlay: null};
        browserTabs.push(tab);
        browserSwitchTab(id);
        if (url) document.getElementById('browser-url').value = url;
        if (url) browserProbe(tab, url);
        return tab;
    }

    // ===== X-Frame-Options / CSP 拒载兜底 =====
    // 探测目标 URL 是否允许 iframe 嵌入；被拒时显示提示覆盖层
    function browserProbe(tab, url) {
        if (!/^https?:\/\//i.test(url)) { browserSetBlocked(tab, null); return; }
        apiRequest('GET', '/rs/browser/probe?url=' + encodeURIComponent(url), null, function(err, resp) {
            if (err || !tab || tab.url !== url) return;
            var fr = resp ? resp.frameable : undefined;
            browserSetBlocked(tab, fr === false ? (resp.reason || '站点禁止被嵌入') : null);
        });
    }

    function browserSetBlocked(tab, reason) {
        if (!tab) return;
        tab._blocked = !!reason;
        if (!reason) {
            if (tab.overlay) tab.overlay.style.display = 'none';
            tab.iframe.style.display = (tab.id === browserActiveId) ? 'block' : 'none';
            return;
        }
        if (!tab.overlay) {
            var host = document.getElementById('panel-browser').querySelector('div[style*="position:relative"]');
            var ov = document.createElement('div');
            ov.style.cssText = 'position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;gap:12px;' +
                'background:var(--bg);color:var(--text);text-align:center;padding:24px;z-index:5;';
            host.appendChild(ov);
            tab.overlay = ov;
        }
        tab.overlay.innerHTML =
            '<div style="font-size:2rem">&#128683;</div>' +
            '<div style="font-weight:600">该页面禁止在内置浏览器中打开</div>' +
            '<div style="font-size:.82rem;color:var(--text-secondary);max-width:420px">' + escapeHtml(reason) + '</div>' +
            '<div style="font-size:.78rem;color:var(--text-light)">可尝试「外部打开」用系统浏览器访问该页面</div>' +
            '<button class="btn btn-primary btn-sm" onclick="window.open(' + JSON.stringify(tab.url).replace(/"/g, '&quot;') + ', \'_blank\')">外部打开</button>';
        tab.iframe.style.display = 'none';
        tab.overlay.style.display = (tab.id === browserActiveId) ? 'flex' : 'none';
    }

    function hostTitleOf(u) {
        try { var h = new URL(u, location.href).hostname; if (h) return h.replace(/^www\./, ''); } catch (e) {}
        var seg = (u || '').split('/').filter(Boolean).pop();
        return seg || '页面';
    }

    function browserCloseTab(id, ev) {
        if (ev) { ev.stopPropagation(); }
        var i = browserTabs.findIndex(function(t){ return t.id === id; });
        if (i === -1) return;
        var t = browserTabs[i];
        if (t.iframe) t.iframe.remove();
        browserTabs.splice(i, 1);
        if (browserActiveId === id) {
            browserActiveId = null;
            var next = browserTabs[Math.min(i, browserTabs.length - 1)];
            if (next) browserSwitchTab(next.id);
            else renderBrowserTabs();
        } else {
            renderBrowserTabs();
        }
    }

    function browserSwitchTab(id) {
        browserActiveId = id;
        browserTabs.forEach(function(t){
            t.iframe.style.display = (t.id === id) ? 'block' : 'none';
            if (t.overlay) {
                // 被拦截的标签：激活时显示提示层，而非 iframe
                t.overlay.style.display = (t.id === id && t._blocked) ? 'flex' : 'none';
                if (t._blocked && t.id === id) t.iframe.style.display = 'none';
            }
        });
        var cur = browserTabs.find(function(t){ return t.id === id; });
        if (cur) document.getElementById('browser-url').value = cur.url || '';
        renderBrowserTabs();
    }

    function renderBrowserTabs() {
        var bar = document.getElementById('browser-tabs');
        var empty = document.getElementById('browser-empty');
        if (empty) empty.style.display = browserTabs.length ? 'none' : 'flex';
        var html = browserTabs.map(function(t){
            var active = t.id === browserActiveId;
            return '<div onclick="browserSwitchTab(\'' + t.id + '\')" title="' + escapeAttr(t.url || '') + '" ' +
                'style="display:flex;align-items:center;gap:6px;padding:4px 8px;border-radius:5px;cursor:pointer;white-space:nowrap;font-size:.75rem;max-width:180px;overflow:hidden;' +
                'background:' + (active ? 'var(--sidebar-active)' : 'var(--sidebar-hover)') + ';' +
                'color:' + (active ? 'var(--primary)' : 'var(--text-secondary)') + ';border:1px solid ' + (active ? 'var(--primary)' : 'transparent') + ';">' +
                '<span style="overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(t.title) + '</span>' +
                '<span onclick="browserCloseTab(\'' + t.id + '\', event)" style="opacity:.6;padding:0 2px;border-radius:3px;">&#10005;</span>' +
                '</div>';
        }).join('');
        bar.innerHTML = html;
    }

    function browserActive() { return browserTabs.find(function(t){ return t.id === browserActiveId; }); }

    function browserNavigate(u) {
        var raw = (u || '').trim();
        // 危险协议白名单拦截（javascript:/data:/vbscript:），防止 iframe src 执行脚本
        if (/^(javascript|data|vbscript):/i.test(raw)) {
            showToast('error', '已拦截危险协议，仅支持 http(s) 网址');
            return;
        }
        u = normalizeUrl(raw);
        if (!u) return;
        var cur = browserActive();
        if (!cur) { cur = browserAddTab(u); return; }
        cur.url = u;
        cur.title = hostTitleOf(u);
        cur.iframe.src = u;
        cur._blocked = false;
        document.getElementById('browser-url').value = u;
        renderBrowserTabs();
        browserProbe(cur, u);
    }

    function browserGo(dir) {
        var cur = browserActive();
        if (!cur) return;
        try { cur.iframe.contentWindow.history.go(dir); } catch (e) { showToast('info', '跨域页面不支持后退/前进'); }
    }

    function browserReload() {
        var cur = browserActive();
        if (!cur || !cur.url) return;
        cur.iframe.src = cur.url;
        browserProbe(cur, cur.url);
    }

    function browserOpenExternal() {
        var cur = browserActive();
        var u = cur && cur.url ? cur.url : normalizeUrl(document.getElementById('browser-url').value);
        if (!u) { showToast('info', '请先输入网址'); return; }
        window.open(u, '_blank');
    }

    // 供 URL/文档列表「打开」按钮调用
    function openInBrowser(url) {
        if (!url) { showToast('info', '该条目没有可打开的地址'); return; }
        if (/^(javascript|data|vbscript):/i.test(url.trim())) {
            showToast('error', '已拦截危险协议，仅支持 http(s) 网址');
            return;
        }
        switchPanel('browser');
        document.querySelectorAll('.nav-item').forEach(function(n){
            n.classList.toggle('active', n.dataset.panel === 'browser');
        });
        browserNavigate(url);
    }

    function loadAiConfigStatus() {
        apiRequest('GET', '/ai/config', null, function(err, resp){
            var info = document.getElementById('aiConfigInfo');
            if (err) { info.textContent = '未配置 AI'; info.style.color = 'var(--danger)'; return; }
            var base = (resp.base_url || '').replace(/^https?:\/\//, '');
            var model = resp.model || '';
            var masked = resp.api_key_masked || '';
            if (base && masked) {
                info.textContent = base + ' · ' + model + ' · Key: ' + masked;
                info.style.color = 'var(--success)';
            } else {
                info.textContent = '未配置 AI';
                info.style.color = 'var(--text-secondary)';
            }
        });
    }

    // 加载 AI 供应商配置到「连接配置」页内字段
    function loadAiConnFields() {
        apiRequest('GET', '/ai/config', null, function(err, resp){
            if (!resp) return;
            if (resp.base_url) document.getElementById('aiBaseUrl').value = resp.base_url;
            if (resp.model) document.getElementById('aiModel').value = resp.model;
            if (resp.system_prompt) document.getElementById('aiSystemPrompt').value = resp.system_prompt;
        });
        apiRequest('GET', '/ai/providers', null, function(err, resp){
            if (!resp) return;
            aiProviders = resp;
            var grid = document.getElementById('aiProviderList');
            grid.innerHTML = '';
            resp.forEach(function(p){
                grid.innerHTML += '<button class="ai-provider-btn" onclick="applyAiProvider(\'' + p.id + '\',\'' + escapeAttr(p.base_url) + '\',\'' + escapeAttr(p.default_model) + '\')">' + p.name + '</button>';
            });
        });
    }

    // AI 助手页「AI 设置」→ 跳转到连接配置页的 AI 供应商区块
    function openAiConfigModal() {
        switchPanel('config');
        loadAiConnFields();
        var item = document.querySelector('.nav-item[data-panel="config"]');
        if (item) {
            document.querySelectorAll('.nav-item').forEach(function(n){ n.classList.remove('active'); });
            item.classList.add('active');
        }
        var card = document.getElementById('aiConnCard');
        if (card) setTimeout(function(){ card.scrollIntoView({behavior:'smooth', block:'center'}); }, 80);
    }

    function applyAiProvider(id, url, model) {
        document.getElementById('aiBaseUrl').value = url;
        document.getElementById('aiModel').value = model;
        showToast('info', '已填入 ' + id);
    }

    function saveAiConfig() {
        var payload = {
            base_url: document.getElementById('aiBaseUrl').value.trim(),
            model: document.getElementById('aiModel').value.trim(),
            system_prompt: document.getElementById('aiSystemPrompt').value.trim(),
        };
        var key = document.getElementById('aiApiKey').value.trim();
        if (key) payload.api_key = key;
        if (!payload.base_url || !payload.model) { showToast('error', 'Base URL 和模型名必填'); return; }
        apiRequest('POST', '/ai/config', payload, function(err, resp){
            if (err) { showToast('error', '保存失败: ' + err); return; }
            showToast('success', 'AI 配置已保存');
            loadAiConfigStatus();
        });
    }

    function testAiConfig() {
        saveAiConfig();
        // 等保存完再测
        setTimeout(function(){
            var oldMsgs = aiMessages.slice();
            aiMessages = [];
            aiSendText('你好, 回复"连接成功"四个字即可');
            setTimeout(function(){
                aiMessages = oldMsgs;
            }, 4000);
        }, 300);
    }

    function aiSendQuick(text) {
        document.getElementById('aiInput').value = text;
        aiSendMessage();
    }

    function aiClearHistory() {
        aiMessages = [];
        document.getElementById('aiChatMessages').innerHTML = '';
        showToast('info', '对话已清空');
    }

    function aiRenderMarkdown(text) {
        var html = escapeHtml(text);
        // 代码块 ```
        html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
        // 行内代码
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        // 粗体 **
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        // 斜体 *
        html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        // 链接 [text](url)
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
        // 换行
        html = html.replace(/\n/g, '<br>');
        return html;
    }

    function aiAppendMsg(role, content) {
        var container = document.getElementById('aiChatMessages');
        var div = document.createElement('div');
        div.className = 'ai-msg ai-msg-' + role;
        var avatar = role === 'user' ? '👤' : '🤖';
        div.innerHTML = '<div class="ai-msg-avatar">' + avatar + '</div><div class="ai-msg-bubble">' + (role === 'ai' ? aiRenderMarkdown(content) : escapeHtml(content)) + '</div>';
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
        return div;
    }

    function aiSendText(text) {
        if (!text || !text.trim()) return;
        aiMessages.push({role:'user', content:text.trim()});
        aiAppendMsg('user', text.trim());
        aiStreamResponse();
    }

    // =================== AI 引用文件 (菜单资源 / 本地上传 / 外部路径) ===================
    var aiAttachments = [];   // [{type:'menu'|'upload'|'path', key, name, module?, id?, path?, content?, url?}]
    var aiAttachUploads = []; // 本地上传暂存 (确定时并入 aiAttachments)

    function aiAttachKey(a) { return a.type + ':' + (a.module || '') + ':' + (a.id || a.path || a.name); }

    function openAiAttachModal() {
        openModal('aiAttachModal');
        aiAttachTab('menu');
        aiAttachRenderAll();
    }

    function aiAttachTab(tab) {
        ['menu','upload','path'].forEach(function(t) {
            document.getElementById('aiAttachPane' + t.charAt(0).toUpperCase() + t.slice(1)).style.display = (t === tab ? 'block' : 'none');
            var b = document.getElementById('aiAttachTab' + t.charAt(0).toUpperCase() + t.slice(1));
            if (b) b.classList.toggle('btn-primary', t === tab);
        });
        if (tab === 'menu') aiAttachLoadMenu();
    }

    function aiAttachLoadMenu() {
        var src = document.getElementById('aiAttachSource').value;
        var kw = document.getElementById('aiAttachKeyword').value.trim();
        var listEl = document.getElementById('aiAttachMenuList');
        listEl.innerHTML = '<div style="padding:10px;color:var(--text-light);font-size:.8rem;">加载中...</div>';
        var url = '/rs/' + src + '/list?page=1&pageSize=200' + (kw ? '&keyword=' + encodeURIComponent(kw) : '');
        apiRequest('GET', url, null, function(err, data) {
            if (err) { listEl.innerHTML = '<div style="padding:10px;color:var(--danger);font-size:.8rem;">加载失败: ' + escapeHtml(err) + '</div>'; return; }
            var rows = (data && data.rows) || [];
            if (!rows.length) { listEl.innerHTML = '<div style="padding:10px;color:var(--text-light);font-size:.8rem;">暂无数据</div>'; return; }
            listEl.innerHTML = rows.map(function(r) {
                var a = {type:'menu', module:src, id:r.id, name:r.name, url:r.url || '', path:r.filePath || ''};
                var checked = aiAttachments.some(function(x){ return aiAttachKey(x) === aiAttachKey(a); });
                return '<label style="display:flex;gap:8px;align-items:center;padding:6px 4px;font-size:.8rem;cursor:pointer;border-bottom:1px solid var(--border);">'
                    + '<input type="checkbox" ' + (checked ? 'checked' : '') + ' onchange="aiAttachToggleMenu(this)" '
                    + 'data-module="' + escapeAttr(src) + '" data-id="' + escapeAttr(r.id) + '" data-name="' + escapeAttr(r.name) + '" '
                    + 'data-url="' + escapeAttr(r.url || '') + '" data-path="' + escapeAttr(r.filePath || '') + '">'
                    + '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeAttr(r.url || r.filePath || r.name) + '">' + escapeHtml(r.name) + '</span></label>';
            }).join('');
        });
    }

    function aiAttachToggleMenu(cb) {
        var a = {type:'menu', module:cb.dataset.module, id:cb.dataset.id, name:cb.dataset.name, url:cb.dataset.url, path:cb.dataset.path};
        var key = aiAttachKey(a);
        var idx = aiAttachments.findIndex(function(x){ return aiAttachKey(x) === key; });
        if (cb.checked) { if (idx < 0) aiAttachments.push(a); }
        else if (idx >= 0) aiAttachments.splice(idx, 1);
        aiAttachUpdateCount();
    }

    function aiAttachPickFiles(files) {
        Array.prototype.forEach.call(files, function(f) {
            if (f.size > 200 * 1024) {
                showToast('warning', '跳过 ' + f.name + '：超过 200KB');
                return;
            }
            var reader = new FileReader();
            reader.onload = function() {
                aiAttachUploads.push({type:'upload', name:f.name, content:String(reader.result || ''), size:f.size});
                aiAttachRenderUploads();
            };
            reader.readAsText(f);
        });
        document.getElementById('aiAttachFileInput').value = '';
    }

    function aiAttachRenderUploads() {
        var el = document.getElementById('aiAttachUploadList');
        if (!aiAttachUploads.length) { el.innerHTML = '<div style="padding:8px;color:var(--text-light);font-size:.78rem;">尚未选择文件</div>'; return; }
        el.innerHTML = aiAttachUploads.map(function(a, i) {
            return '<div style="display:flex;gap:8px;align-items:center;padding:5px 4px;font-size:.8rem;border-bottom:1px solid var(--border);">'
                + '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(a.name) + '</span>'
                + '<span style="color:var(--text-light);font-size:.72rem;">' + formatSize(a.size || 0) + '</span>'
                + '<button class="btn btn-sm btn-danger" style="padding:1px 8px;font-size:.7rem;" onclick="aiAttachUploads.splice(' + i + ',1);aiAttachRenderUploads()">移除</button></div>';
        }).join('');
    }

    function aiAttachAddPath() {
        var input = document.getElementById('aiAttachPathInput');
        var p = input.value.trim();
        if (!p) return;
        var a = {type:'path', path:p, name:p.split('/').pop()};
        if (!aiAttachments.some(function(x){ return aiAttachKey(x) === aiAttachKey(a); })) aiAttachments.push(a);
        input.value = '';
        aiAttachRenderAll();
    }

    function aiAttachRemove(i) {
        aiAttachments.splice(i, 1);
        aiAttachRenderAll();
    }

    function aiAttachUpdateCount() {
        var el = document.getElementById('aiAttachCount');
        if (el) el.textContent = '已选 ' + aiAttachments.length + ' 项';
    }

    function aiAttachRenderAll() {
        aiAttachUpdateCount();
        // 菜单 tab 勾选状态回显
        document.querySelectorAll('#aiAttachMenuList input[type=checkbox]').forEach(function(cb) {
            var key = 'menu:' + cb.dataset.module + ':' + cb.dataset.id;
            cb.checked = aiAttachments.some(function(x){ return aiAttachKey(x) === key; });
        });
        aiAttachRenderUploads();
        // 外部路径列表
        var paths = aiAttachments.filter(function(a){ return a.type === 'path'; });
        var el = document.getElementById('aiAttachPathList');
        el.innerHTML = paths.length ? paths.map(function(a) {
            var i = aiAttachments.indexOf(a);
            return '<div style="display:flex;gap:8px;align-items:center;padding:5px 4px;font-size:.8rem;border-bottom:1px solid var(--border);">'
                + '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeAttr(a.path) + '">' + escapeHtml(a.path) + '</span>'
                + '<button class="btn btn-sm btn-danger" style="padding:1px 8px;font-size:.7rem;" onclick="aiAttachRemove(' + i + ')">移除</button></div>';
        }).join('') : '<div style="padding:8px;color:var(--text-light);font-size:.78rem;">尚未挂载路径</div>';
        renderAiAttachChips();
    }

    function aiAttachConfirm() {
        // 并入本地上传项 (按名称去重)
        aiAttachUploads.forEach(function(u) {
            if (!aiAttachments.some(function(x){ return x.type === 'upload' && x.name === u.name; })) aiAttachments.push(u);
        });
        aiAttachUploads = [];
        document.getElementById('aiAttachFileInput').value = '';
        closeModal('aiAttachModal');
        renderAiAttachChips();
        showToast('success', '已引用 ' + aiAttachments.length + ' 项');
    }

    function renderAiAttachChips() {
        var box = document.getElementById('aiAttachChips');
        if (!aiAttachments.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
        box.style.display = 'flex';
        var typeLabel = {menu:'菜单', upload:'上传', path:'路径'};
        box.innerHTML = aiAttachments.map(function(a, i) {
            return '<span style="display:inline-flex;align-items:center;gap:4px;font-size:.72rem;padding:2px 8px;border-radius:12px;'
                + 'background:var(--sidebar-active);border:1px solid var(--card-border);color:var(--text);max-width:220px;">'
                + '<span style="opacity:.65;">[' + typeLabel[a.type] + ']</span>'
                + '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(a.name) + '</span>'
                + '<button onclick="aiAttachRemove(' + i + ')" style="background:none;border:none;color:var(--danger);cursor:pointer;padding:0;font-size:.8rem;">&times;</button></span>';
        }).join('');
    }

    // =================== 需求 7: AI 预设选择 ===================
    var aiPresets = [];
    var aiCurrentPresetId = '';

    function loadAiPresets(cb) {
        apiRequest('GET', '/rs/ai-preset/active', null, function(err, resp) {
            aiPresets = (!err && Array.isArray(resp)) ? resp : [];
            var sel = document.getElementById('aiPresetSel');
            var keep = aiCurrentPresetId;
            var html = '<option value="">默认（不使用预设）</option>' + aiPresets.map(function(p){
                return '<option value="' + escapeAttr(p.id) + '">' + escapeHtml(p.name) +
                    (p.isDefault ? ' ★' : '') + '</option>';
            }).join('');
            sel.innerHTML = html;
            if (keep && aiPresets.some(function(p){ return p.id === keep; })) {
                sel.value = keep;
            } else {
                var def = aiPresets.find(function(p){ return p.isDefault; });
                if (def) { sel.value = def.id; aiCurrentPresetId = def.id; }
                else { aiCurrentPresetId = ''; sel.value = ''; }
            }
            if (cb) cb();
        });
    }

    function onAiPresetChange(v) {
        aiCurrentPresetId = v || '';
        var p = aiPresets.find(function(x){ return x.id === aiCurrentPresetId; });
        if (p) showToast('info', '已选择预设「' + p.name + '」');
    }

    function aiMessagesForRequest() {
        var msgs = aiMessages.slice();
        var p = aiPresets.find(function(x){ return x.id === aiCurrentPresetId; });
        if (p && p.formatPrompt) {
            var sys = p.formatPrompt;
            if (p.exampleOutput) sys += '\n\n【输出示例】\n' + p.exampleOutput;
            msgs.unshift({role:'system', content:sys});
        }
        return msgs;
    }

    function aiSendMessage() {
        var input = document.getElementById('aiInput');
        var text = input.value.trim();
        input.value = '';
        aiSendText(text);
    }

    function aiStreamResponse() {
        var loadingDiv = aiAppendMsg('ai', '▌');
        var bubble = loadingDiv.querySelector('.ai-msg-bubble');
        bubble.classList.add('ai-msg-loading');
        var fullContent = '';

        var btn = document.getElementById('aiSendBtn');
        btn.disabled = true;

        fetch(resolveApiUrl('/ai/chat'), {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({messages: aiMessagesForRequest(), attachments: aiAttachments}),
        }).then(function(resp){
            if (!resp.ok) return resp.text().then(function(t){ throw new Error(t); });
            var reader = resp.body.getReader();
            var decoder = new TextDecoder();
            var buffer = '';

            function readChunk() {
                reader.read().then(function(result){
                    if (result.done) {
                        bubble.classList.remove('ai-msg-loading');
                        bubble.textContent = '';
                        bubble.innerHTML = aiRenderMarkdown(fullContent || '(无响应)');
                        if (fullContent) aiMessages.push({role:'assistant', content:fullContent});
                        btn.disabled = false;
                        return;
                    }
                    buffer += decoder.decode(result.value, {stream:true});
                    var lines = buffer.split('\n');
                    buffer = lines.pop();
                    lines.forEach(function(line){
                        line = line.trim();
                        if (!line.startsWith('data: ')) return;
                        var data = line.slice(6);
                        if (data === '[DONE]') return;
                        try {
                            var obj = JSON.parse(data);
                            if (obj.error) {
                                bubble.classList.remove('ai-msg-loading');
                                bubble.innerHTML = '<span style="color:var(--danger)">❌ ' + escapeHtml(obj.error) + '</span>';
                                btn.disabled = false;
                            } else if (obj.content) {
                                fullContent += obj.content;
                                bubble.textContent = fullContent + '▌';
                                document.getElementById('aiChatMessages').scrollTop = 999999;
                            }
                        } catch(e) {}
                    });
                    readChunk();
                }).catch(function(err){
                    bubble.classList.remove('ai-msg-loading');
                    bubble.innerHTML = '<span style="color:var(--danger)">❌ ' + escapeHtml(err.message) + '</span>';
                    btn.disabled = false;
                });
            }
            readChunk();
        }).catch(function(err){
            bubble.classList.remove('ai-msg-loading');
            bubble.innerHTML = '<span style="color:var(--danger)">❌ ' + escapeHtml(err.message || err) + '</span>';
            btn.disabled = false;
        });
    }

    // 初次进入 AI 面板时的欢迎语
    aiMessages.push({role:'assistant', content:'你好! 我是项目管理工具 AI 助手 🤖\n\n我可以帮你:\n- 📋 分析桶内文件列表\n- 🔍 搜索和识别最新上传文件\n- 📊 生成存储统计报告\n- 💡 解答 MinIO 使用问题\n\n请先点击右上角 **AI 设置** 配置 API Key, 然后开始对话吧 ~'});
    aiAppendMsg('ai', aiMessages[0].content);

    // =================== 需求 8: 菜单分组动态渲染 ===================
    var menuGroupsData = [];
    function loadAndRenderMenu() {
        apiRequest('GET', '/rs/menu/list', null, function(err, resp) {
            if (err) { console.warn('菜单加载失败:', err); return; }
            menuGroupsData = resp;
            var nav = document.getElementById('sidebarNav');
            nav.innerHTML = '';

            var groupOrder = ['resources', 'ai', 'system'];
            groupOrder.forEach(function(gk) {
                var g = resp.find(function(x){ return x.groupKey === gk; });
                if (!g || !g.items || g.items.length === 0) return;
                var hdr = document.createElement('div');
                hdr.className = 'nav-group-hdr';
                hdr.style.cssText = 'font-size:.7rem;color:var(--nav-group-text);padding:8px 12px 2px;text-transform:uppercase;letter-spacing:1px;font-weight:600;white-space:nowrap;overflow:hidden;';
                hdr.textContent = g.groupLabel;
                nav.appendChild(hdr);
                g.items.forEach(function(it) {
                    if (!it.visible) return;
                    var item = document.createElement('div');
                    item.className = 'nav-item';
                    item.dataset.panel = it.panel || it.menuKey;
                    // 初始激活项：优先恢复上次面板，默认 config
                    var savedPanel = null;
                    try { savedPanel = localStorage.getItem('ui_active_panel'); } catch(e) {}
                    var initialActive = savedPanel ? (savedPanel === item.dataset.panel) : (it.panel === 'config');
                    if (initialActive) item.classList.add('active');
                    item.innerHTML = '<span class="nav-icon">' + (it.icon || '&#9881;') + '</span><span class="nav-label">' + escapeHtml(it.displayName) + '</span>';
                    item.addEventListener('click', function(e) {
                        document.querySelectorAll('.nav-item').forEach(function(n){ n.classList.remove('active'); });
                        item.classList.add('active');
                        var p = document.getElementById('panel-' + item.dataset.panel);
                        if (p) {
                            document.querySelectorAll('.panel').forEach(function(x){ x.classList.remove('active'); });
                            p.classList.add('active');
                            document.getElementById('pageTitle').textContent = it.displayName;
                            try { localStorage.setItem('ui_active_panel', item.dataset.panel); } catch(e) {}
                            // 触发对应模块 load
                            if (crudModules[item.dataset.panel]) {
                                if (crudModules[item.dataset.panel]._cfg && crudModules[item.dataset.panel]._cfg.catModule) {
                                    initCatFilter(item.dataset.panel);
                                }
                                crudModules[item.dataset.panel].load();
                            }
                        }
                    });
                    nav.appendChild(item);
                });
            });

            // 恢复上次激活的面板（nav 高亮已按保存值渲染，这里同步 panel 显隐）
            try {
                var saved = localStorage.getItem('ui_active_panel');
                if (saved) {
                    var savedPanelEl = document.getElementById('panel-' + saved);
                    if (savedPanelEl && !savedPanelEl.classList.contains('active')) {
                        var target = nav.querySelector('.nav-item[data-panel="' + saved + '"]');
                        if (target) target.click();
                    }
                }
            } catch(e) {}
        });
    }

    // =================== 通用 CRUD 模块 ===================
    /* 配置对象:
       {
           panel:  'urls' | 'online-docs' | ...,
           listApi: '/rs/url/list',
           createApi: '/rs/url',
           updateApi: '/rs/url/{id}',
           deleteApi: '/rs/url/{id}',
           batchCreateApi: '/rs/url/batch',
           batchDeleteApi: '/rs/url/batch-delete',
           importModule: 'url',
           fields: [{key:'name',label:'名称',required:true},{key:'url',label:'地址',required:true}],
           columns: [{key:'name',label:'名称'},{key:'url',label:'地址'}],
           rowActions: ['edit','delete','open'],
           tableId: 'urls-table',
           tbodyId: 'urls-tbody',
           pageId: 'urls-pagination',
           keywordId: 'urls-keyword',
           checkAllId: 'urls-check-all',
           batchDelBtnId: 'urls-batch-del',
           renderRow: function(row){ return html; }
       }
    */
    var crudModules = {};
    function crudModule(name) { return crudModules[name]; }

    // =================== 三级分类工具 ===================
    var catTreeCache = {};   // category.module -> tree
    function loadCatTree(module, cb) {
        if (catTreeCache[module]) { cb(catTreeCache[module]); return; }
        apiRequest('GET', '/rs/category/' + module, null, function(err, resp) {
            if (err) { cb([]); return; }
            catTreeCache[module] = resp || [];
            cb(catTreeCache[module]);
        });
    }
    function invalidateCatTree(module) { delete catTreeCache[module]; }

    function fillSelect(selId, list, placeholder) {
        var el = document.getElementById(selId);
        if (!el) return;
        var cur = el.value;
        el.innerHTML = '<option value="">' + placeholder + '</option>' +
            (list || []).map(function(n) {
                return '<option value="' + n.id + '">' + escapeHtml(n.name) + '</option>';
            }).join('');
        // 保持仍存在的选中项
        if (cur && (list || []).some(function(n){ return n.id === cur; })) el.value = cur;
    }

    function catPrefixOf(cfg) { return cfg.tableId.replace('-table', ''); }

    // 初始化某模块的级联筛选（拉树 + 填一级）
    function initCatFilter(name) {
        var mod = crudModules[name];
        if (!mod || !mod._cfg.catModule) return;
        loadCatTree(mod._cfg.catModule, function(tree) {
            fillSelect(catPrefixOf(mod._cfg) + '-cat1', tree, '一级分类');
            fillSelect(catPrefixOf(mod._cfg) + '-cat2', [], '二级分类');
            fillSelect(catPrefixOf(mod._cfg) + '-cat3', [], '三级分类');
        });
    }

    // 级联下拉变化：填充下一级 + 清空更深层 + 重新加载
    function onCatChange(name, level) {
        var mod = crudModules[name];
        if (!mod) return;
        var p = catPrefixOf(mod._cfg);
        loadCatTree(mod._cfg.catModule, function(tree) {
            var sel1 = document.getElementById(p + '-cat1');
            var n1 = tree.find(function(n){ return n.id === sel1.value; }) || null;
            if (level === 1) {
                fillSelect(p + '-cat2', n1 ? (n1.children || []) : [], '二级分类');
                fillSelect(p + '-cat3', [], '三级分类');
            } else if (level === 2) {
                var sel2 = document.getElementById(p + '-cat2');
                var n2 = (n1 ? (n1.children || []) : []).find(function(n){ return n.id === sel2.value; }) || null;
                fillSelect(p + '-cat3', n2 ? (n2.children || []) : [], '三级分类');
            }
            mod.page = 1;
            mod.load();
        });
    }

    // 读取当前选中的分类参数串
    function catQuery(mod) {
        var cfg = mod._cfg;
        if (!cfg.catModule) return '';
        var p = catPrefixOf(cfg);
        var v = function(l) { var e = document.getElementById(p + '-cat' + l); return e ? e.value : ''; };
        var v1 = v(1), v2 = v(2), v3 = v(3);
        if (cfg.catMode === 'single') {
            var s = v3 || v2 || v1;
            return s ? '&categoryId=' + encodeURIComponent(s) : '';
        }
        var qs = '';
        if (v1) qs += '&categoryId1=' + encodeURIComponent(v1);
        if (v2) qs += '&categoryId2=' + encodeURIComponent(v2);
        if (v3) qs += '&categoryId3=' + encodeURIComponent(v3);
        return qs;
    }

    // 分组行折叠/展开
    function toggleCatGroupRow(tr) {
        var depth = parseInt(tr.dataset.depth || '0', 10);
        var wasCollapsed = tr.dataset.collapsed === '1';
        tr.dataset.collapsed = wasCollapsed ? '0' : '1';
        var arrow = tr.querySelector('.cat-grp-arrow');
        if (arrow) arrow.innerHTML = wasCollapsed ? '&#9662;' : '&#9656;';
        // 收集区间内行（到第一个 depth<=d 的分组行为止）
        var rows = [], el = tr.nextElementSibling;
        while (el) {
            if (el.classList.contains('cat-grp-row') && parseInt(el.dataset.depth || '0', 10) <= depth) break;
            rows.push(el);
            el = el.nextElementSibling;
        }
        // 折叠：全部隐藏；展开：按祖先折叠栈重新计算可见性
        rows.forEach(function(r) { r.style.display = wasCollapsed ? '' : 'none'; });
        if (wasCollapsed) {
            var stack = [tr];
            rows.forEach(function(r) {
                if (r.classList.contains('cat-grp-row')) {
                    var d = parseInt(r.dataset.depth || '0', 10);
                    while (stack.length && parseInt(stack[stack.length - 1].dataset.depth || '0', 10) >= d) stack.pop();
                    stack.push(r);
                }
                var hidden = stack.some(function(g) { return g.dataset.collapsed === '1'; });
                r.style.display = hidden ? 'none' : '';
            });
        }
    }

    // =================== 分类管理 Modal ===================
    var _catMgrModule = null;
    // ===== 工具栏「⋯ 更多」下拉 =====
    function closeMoreMenus() {
        document.querySelectorAll('.more-menu.open').forEach(function(m) { m.classList.remove('open'); });
    }
    function toggleMoreMenu(e) {
        if (e && e.stopPropagation) e.stopPropagation();
        var menu = e && e.currentTarget ? e.currentTarget.nextElementSibling : null;
        if (!menu) return;
        var wasOpen = menu.classList.contains('open');
        closeMoreMenus();
        if (!wasOpen) menu.classList.add('open');
    }
    document.addEventListener('click', function(e) {
        if (!e.target.closest || !e.target.closest('.more-wrap')) closeMoreMenus();
    });

    function openCatMgr(name) {
        _catMgrModule = name;
        var mod = crudModules[name];
        openModal('catMgrModal');
        renderCatMgr();
    }
    function renderCatMgr() {
        var mod = crudModules[_catMgrModule];
        var area = document.getElementById('catMgrTree');
        loadCatTree(mod._cfg.catModule, function(tree) {
            if (!tree.length) {
                area.innerHTML = '<div style="color:var(--text-secondary);padding:12px;text-align:center">暂无分类，点击下方新增一级分类</div>';
                return;
            }
            function nodeHtml(n, depth) {
                var pad = 10 + depth * 22;
                var h = '<div style="display:flex;align-items:center;gap:6px;padding:5px 8px 5px ' + pad + 'px;border-bottom:1px solid var(--border);font-size:.85rem">' +
                    '<span style="color:var(--text-secondary)">L' + n.level + '</span>' +
                    '<span style="flex:1">' + escapeHtml(n.name) + '</span>';
                if (depth < 2) h += '<button class="btn btn-sm" onclick="catCreate(\'' + n.id + '\',' + (n.level + 1) + ')">+ 子级</button>';
                h += '<button class="btn btn-sm" onclick="catRename(\'' + n.id + '\')">改名</button>' +
                    '<button class="btn btn-sm btn-danger" onclick="catDelete(\'' + n.id + '\')">删除</button></div>';
                (n.children || []).forEach(function(c) { h += nodeHtml(c, depth + 1); });
                return h;
            }
            area.innerHTML = tree.map(function(n) { return nodeHtml(n, 0); }).join('');
        });
    }
    function catCreate(parentId, level) {
        var name = prompt('输入 ' + level + ' 级分类名称:');
        if (!name) return;
        var mod = crudModules[_catMgrModule];
        apiRequest('POST', '/rs/category', { module: mod._cfg.catModule, name: name, level: level, parentId: parentId || '' }, function(err) {
            if (err) { showToast('error', err); return; }
            invalidateCatTree(mod._cfg.catModule);
            renderCatMgr();
            initCatFilter(_catMgrModule);
        });
    }
    function catRename(id) {
        var name = prompt('输入新名称:');
        if (!name) return;
        var mod = crudModules[_catMgrModule];
        apiRequest('PUT', '/rs/category/' + id, { name: name }, function(err) {
            if (err) { showToast('error', err); return; }
            invalidateCatTree(mod._cfg.catModule);
            renderCatMgr();
            initCatFilter(_catMgrModule);
        });
    }
    function catDelete(id) {
        if (!confirm('确认删除该分类及其子分类?')) return;
        var mod = crudModules[_catMgrModule];
        apiRequest('DELETE', '/rs/category/' + id, {}, function(err) {
            if (err) { showToast('error', err); return; }
            invalidateCatTree(mod._cfg.catModule);
            renderCatMgr();
            initCatFilter(_catMgrModule);
        });
    }

    function defineCrudModule(cfg) {
        var mod = {
            name: cfg.name,
            panel: cfg.panel,
            page: 1,
            pageSize: 20,
            total: 0,
            rows: [],
            selectedIds: {},
            editedId: null,
            groupView: false,

            load: function() {
                var self = this;
                var kwEl = document.getElementById(cfg.keywordId);
                var keyword = kwEl ? kwEl.value.trim() : '';
                var qs;
                if (self.groupView && cfg.catModule) {
                    // 分组视图：服务端聚合 byCat/counts，不再由浏览器分组
                    qs = '?grouped=1&catMode=' + (cfg.catMode === 'single' ? 'single' : 'three');
                    if (keyword) qs += '&keyword=' + encodeURIComponent(keyword);
                    qs += catQuery(self);
                } else {
                    qs = '?page=' + self.page + '&pageSize=' + self.pageSize;
                    if (keyword) qs += '&keyword=' + encodeURIComponent(keyword);
                    qs += catQuery(self);
                }
                apiRequest('GET', cfg.listApi + qs, null, function(err, resp) {
                    if (err) { showToast('error', '加载失败: ' + err); return; }
                    self.rows = resp.rows || [];
                    self.total = resp.total || 0;
                    if (self.groupView && cfg.catModule) {
                        self._srvByCat = resp.byCat || {};
                        self._srvCounts = resp.counts || {};
                        if (resp.truncated) showToast('info', '数据超过 5000 条，分组视图仅显示前 5000 条');
                        loadCatTree(cfg.catModule, function(tree) { self.renderGrouped(tree); });
                    } else {
                        self.render();
                    }
                });
            },

            rowHtml: function(row) {
                var self = this;
                var selected = self.selectedIds[row.id] ? 'checked' : '';
                var cells = cfg.columns.map(function(c) {
                    var v = row[c.key];
                    if (c.key === 'fileSize' && v) v = (v/1024).toFixed(1) + ' KB';
                    if (c.key === 'exists') v = v ? '<span style="color:var(--success)">✓</span>' : '<span style="color:var(--danger)">✗ 缺失</span>';
                    if (c.key === 'isDefault') v = v ? '⭐ 默认' : '';
                    if (c.key === 'enabled') v = v ? '<span style="color:var(--success)">✓</span>' : '<span style="color:var(--danger)">✗</span>';
                    return '<td style="padding:8px 10px;border-bottom:1px solid var(--border);font-size:.85rem">' + (v || '') + '</td>';
                }).join('');
                var actions = '';
                if (cfg.rowActions.indexOf('open') >= 0) {
                    var openUrl = row.url || '';
                    if (!openUrl && cfg.name === 'local-doc') openUrl = '/rs/local-doc/download/' + row.id;
                    if (!openUrl && cfg.name === 'md') openUrl = '/rs/md/' + row.id + '/page';
                    if (!openUrl) openUrl = row.filePath || '';
                    actions += '<button class="btn btn-sm" onclick="openInBrowser(\'' + (openUrl || '').replace(/'/g,"\\'") + '\')">打开</button> ';
                }
                if (cfg.rowActions.indexOf('preview') >= 0) {
                    actions += '<button class="btn btn-sm" onclick="openDocPreview(\'' + row.id + '\')">预览</button> ';
                }
                if (cfg.rowActions.indexOf('edit') >= 0) {
                    actions += '<button class="btn btn-sm" onclick="crudModule(\'' + self.name + '\').openEdit(\'' + row.id + '\')">编辑</button> ';
                }
                if (cfg.rowActions.indexOf('viewMd') >= 0) {
                    actions += '<button class="btn btn-sm" onclick="openMdView(\'' + row.id + '\')">查看</button> ';
                }
                if (cfg.rowActions.indexOf('delete') >= 0) {
                    actions += '<button class="btn btn-sm btn-danger" onclick="crudModule(\'' + self.name + '\').deleteOne(\'' + row.id + '\')">删除</button>';
                }
                return '<tr>' +
                    '<td style="padding:8px;border-bottom:1px solid var(--border);text-align:center"><input type="checkbox" ' + selected + ' data-id="' + row.id + '" onchange="crudModule(\'' + self.name + '\').toggleOne(this)"></td>' +
                    cells + '<td style="padding:6px;border-bottom:1px solid var(--border);white-space:nowrap">' + actions + '</td></tr>';
            },

            render: function(keepRows) {
                var self = this;
                var tbody = document.getElementById(cfg.tbodyId);
                if (!tbody) return;
                if (!keepRows) {
                    if (self.rows.length === 0) {
                        tbody.innerHTML = '<tr><td colspan="' + (cfg.columns.length + 2) + '" style="text-align:center;padding:32px;color:var(--text-secondary)">暂无数据</td></tr>';
                    } else {
                        tbody.innerHTML = self.rows.map(function(row) { return self.rowHtml(row); }).join('');
                    }
                }
                // 分页
                var pageEl = document.getElementById(cfg.pageId);
                if (pageEl) {
                    if (self.groupView) {
                        pageEl.innerHTML = '<span style="font-size:.8rem;color:var(--text-secondary)">分组视图 · 共 ' + self.rows.length + ' 条（不分页）</span>';
                    } else {
                    var totalPages = Math.max(1, Math.ceil(self.total / self.pageSize));
                    var html = '';
                    html += '<span style="font-size:.8rem;color:var(--text-secondary)">共 ' + self.total + ' 条</span>';
                    html += '<button class="btn btn-sm" ' + (self.page<=1?'disabled':'') + ' onclick="crudModule(\'' + self.name + '\').goPage(' + (self.page-1) + ')">上一页</button>';
                    html += '<span style="font-size:.8rem">' + self.page + ' / ' + totalPages + '</span>';
                    html += '<button class="btn btn-sm" ' + (self.page>=totalPages?'disabled':'') + ' onclick="crudModule(\'' + self.name + '\').goPage(' + (self.page+1) + ')">下一页</button>';
                    // 已选计数
                    var selCount = Object.keys(self.selectedIds).length;
                    if (selCount > 0) {
                        html += '<span style="color:var(--primary);font-size:.8rem">已选 ' + selCount + ' 项</span>';
                    }
                    pageEl.innerHTML = html;
                    }
                }
                // 批量按钮状态
                var batchDel = document.getElementById(cfg.batchDelBtnId);
                if (batchDel) batchDel.disabled = Object.keys(self.selectedIds).length === 0;
            },

            // 分组视图：按一级>二级>三级分类树分组渲染，可折叠
            // 分组归属与计数来自服务端聚合（byCat/counts），前端只负责渲染
            renderGrouped: function(tree) {
                var self = this;
                var tbody = document.getElementById(cfg.tbodyId);
                if (!tbody) return;
                self._groupTree = tree;
                var cols = cfg.columns.length + 2;
                // 服务端聚合: catId -> [rowId]；缺失时回退前端分组
                var byCatIds = self._srvByCat || null;
                var counts = self._srvCounts || null;
                var rowById = {};
                self.rows.forEach(function(r) { rowById[r.id] = r; });
                var byCat = {};
                if (byCatIds) {
                    Object.keys(byCatIds).forEach(function(cid) {
                        byCat[cid] = byCatIds[cid].map(function(rid) { return rowById[rid]; }).filter(Boolean);
                    });
                } else {
                    self.rows.forEach(function(r) {
                        var cid = (cfg.catMode === 'single')
                            ? (r.categoryId || '')
                            : (r.categoryId3 || r.categoryId2 || r.categoryId1 || '');
                        (byCat[cid] = byCat[cid] || []).push(r);
                    });
                }
                function nodeCount(node) {
                    if (counts) {
                        // 服务端只给了直接条数，子孙求和仍需遍历
                        var n = counts[node.id] || 0;
                        (node.children || []).forEach(function(k) { n += nodeCount(k); });
                        return n;
                    }
                    var m = (byCat[node.id] || []).length;
                    (node.children || []).forEach(function(k) { m += (byCat[k.id] || []).length; });
                    return m;
                }
                var out = [];
                function walk(list, depth, prefix) {
                    (list || []).forEach(function(node) {
                        var path = prefix + node.id;
                        var mine = byCat[node.id] || [];
                        var total = nodeCount(node);
                        out.push('<tr class="cat-grp-row" data-depth="' + depth + '" onclick="toggleCatGroupRow(this)" style="cursor:pointer;background:var(--sidebar-hover,rgba(0,0,0,.03))">' +
                            '<td colspan="' + cols + '" style="padding:6px 10px 6px ' + (12 + depth * 18) + 'px;font-weight:600;font-size:.85rem;border-bottom:1px solid var(--border)">' +
                            '<span class="cat-grp-arrow">&#9656;</span> ' + escapeHtml(node.name) +
                            ' <span style="font-weight:400;color:var(--text-secondary)">(' + total + ')</span></td></tr>');
                        mine.forEach(function(r) {
                            out.push('<tr data-grp="' + path + '">' + self.rowHtml(r).replace(/^<tr>/, '').replace(/<\/tr>$/, '') + '</tr>');
                        });
                        walk(node.children, depth + 1, path + '|');
                    });
                }
                walk(tree, 0, '');
                if (out.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="' + cols + '" style="text-align:center;padding:32px;color:var(--text-secondary)">暂无数据</td></tr>';
                } else {
                    tbody.innerHTML = out.join('');
                }
                self.render(true);
            },

            toggleGroupView: function() {
                var self = this;
                self.groupView = !self.groupView;
                self.page = 1;
                try { localStorage.setItem('ui_group_view_' + self.name, self.groupView ? '1' : '0'); } catch(e) {}
                var btn = document.getElementById(catPrefixOf(cfg) + '-group-btn');
                if (btn) btn.classList.toggle('btn-primary', self.groupView);
                self.load();
            },

            goPage: function(p) { if (this.groupView) return; this.page = p; this.load(); },
            reload: function() { this.page = 1; this.load(); },
            toggleAll: function(el) {
                var self = this;
                var boxes = document.querySelectorAll('#' + cfg.tbodyId + ' input[type=checkbox][data-id]');
                boxes.forEach(function(b) {
                    if (el.checked) self.selectedIds[b.dataset.id] = true;
                    else delete self.selectedIds[b.dataset.id];
                });
                if (self.groupView && self._groupTree) self.renderGrouped(self._groupTree);
                else self.render();
            },
            toggleOne: function(el) {
                if (el.checked) this.selectedIds[el.dataset.id] = true;
                else delete this.selectedIds[el.dataset.id];
                if (this.groupView && this._groupTree) this.renderGrouped(this._groupTree);
                else this.render();
            },

            openCreate: function() { this.editedId = null; openCrudModal(this); },
            openEdit: function(id) {
                var self = this;
                var row = self.rows.find(function(r){ return r.id === id; });
                if (!row) return;
                self.editedId = id;
                openCrudModal(self, row);
            },
            save: function() {
                var self = this;
                var data = {};
                cfg.fields.forEach(function(f) {
                    var v = document.getElementById('f_' + f.key);
                    if (f.type === 'cascade' || !v) return;
                    data[f.key] = (f.type === 'checkbox') ? v.checked : v.value.trim();
                });
                // 所属分类（cascade 字段）
                if (cfg.fields.some(function(f){ return f.type === 'cascade'; })) {
                    var cv = function(id) { var e = document.getElementById(id); return e ? e.value : ''; };
                    if (cfg.catMode === 'single') {
                        data.categoryId = cv('f_cat3') || cv('f_cat2') || cv('f_cat1') || '';
                    } else {
                        data.categoryId1 = cv('f_cat1');
                        data.categoryId2 = cv('f_cat2');
                        data.categoryId3 = cv('f_cat3');
                    }
                }
                // 必填校验
                for (var i = 0; i < cfg.fields.length; i++) {
                    var f = cfg.fields[i];
                    if (f.required && !data[f.key]) { showToast('error', f.label + ' 必填'); return; }
                }
                var url = self.editedId ? cfg.updateApi.replace('{id}', self.editedId) : cfg.createApi;
                var method = self.editedId ? 'PUT' : 'POST';
                apiRequest(method, url, data, function(err, resp) {
                    if (err) { showToast('error', '保存失败: ' + err); return; }
                    showToast('success', '保存成功');
                    closeModal('crudModal');
                    self.reload();
                });
            },

            deleteOne: function(id) {
                var self = this;
                if (!confirm('确认删除这条记录?')) return;
                var data = {};
                if (cfg.hasLocalFile) data.deleteLocalFile = confirm('同时删除本地文件吗?\n\n确认=删本地，取消=只删记录');
                var url = cfg.deleteApi.replace('{id}', id);
                apiRequest('DELETE', url, data, function(err, resp) {
                    if (err) { showToast('error', '删除失败: ' + err); return; }
                    showToast('success', '已删除');
                    delete self.selectedIds[id];
                    self.load();
                });
            },
            batchDelete: function() {
                var self = this;
                var ids = Object.keys(self.selectedIds);
                if (ids.length === 0) return;
                if (!confirm('确认删除 ' + ids.length + ' 条记录?')) return;
                var data = { ids: ids };
                if (cfg.hasLocalFile) data.deleteLocalFile = confirm('同时删除对应的本地文件吗?');
                apiRequest('POST', cfg.batchDeleteApi, data, function(err, resp) {
                    if (err) { showToast('error', '批量删除失败: ' + err); return; }
                    showToast('success', '已删除 ' + (resp.count || ids.length) + ' 条');
                    self.selectedIds = {};
                    self.reload();
                });
            },

            batchUpdate: function() {
                var ids = Object.keys(this.selectedIds);
                if (ids.length === 0) { showToast('error', '请先勾选'); return; }
                showToast('info', '批量修改：' + ids.length + ' 条');
            },

            openImport: function() {
                document.getElementById('importText').value = '';
                document.getElementById('importModal').dataset.module = cfg.importModule;
                openModal('importModal');
            }
        };
        mod._cfg = cfg;
        // 恢复用户上次的分组视图状态
        try {
            if (localStorage.getItem('ui_group_view_' + cfg.name) === '1') {
                mod.groupView = true;
                var gbtn = document.getElementById(catPrefixOf(cfg) + '-group-btn');
                if (gbtn) gbtn.classList.add('btn-primary');
            }
        } catch(e) {}
        crudModules[cfg.name] = mod;
        return mod;
    }

    // 通用 Modal 渲染器
    var _crudActiveModule = null;
    function openCrudModal(mod, row) {
        _crudActiveModule = mod;
        var title = document.getElementById('crudModalTitle');
        title.textContent = mod.editedId ? '编辑' : '新增';
        var fields = document.getElementById('crudModalFields');
        var cfg = mod._cfg;
        fields.innerHTML = cfg.fields.map(function(f) {
            var type = f.type || 'text';
            var val = row ? (row[f.key] || '') : '';
            var req = f.required ? ' *' : '';
            var ph = f.placeholder || '';
            if (type === 'textarea') {
                return '<div class="form-group"><label>' + f.label + req + '</label><textarea class="form-control" id="f_' + f.key + '" rows="3" placeholder="' + ph + '">' + escapeHtml(val) + '</textarea></div>';
            }
            if (type === 'select') {
                var opts = (f.options || []).map(function(o) {
                    return '<option value="' + o.v + '"' + (o.v === val ? ' selected' : '') + '>' + o.l + '</option>';
                }).join('');
                return '<div class="form-group"><label>' + f.label + req + '</label><select class="form-control" id="f_' + f.key + '">' + opts + '</select></div>';
            }
            if (type === 'checkbox') {
                return '<div class="form-group" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="f_' + f.key + '" ' + (val ? 'checked' : '') + '><label>' + f.label + '</label></div>';
            }
            if (type === 'cascade') {
                return '<div class="form-group"><label>' + f.label + req + '</label>' +
                    '<div style="display:flex;gap:6px;">' +
                    '<select class="form-control" id="f_cat1" onchange="onCascadeChange(1)"><option value="">一级分类</option></select>' +
                    '<select class="form-control" id="f_cat2" onchange="onCascadeChange(2)"><option value="">二级分类</option></select>' +
                    '<select class="form-control" id="f_cat3" onchange="onCascadeChange(3)"><option value="">三级分类</option></select>' +
                    '</div></div>';
            }
            return '<div class="form-group"><label>' + f.label + req + '</label><input type="' + type + '" class="form-control" id="f_' + f.key + '" value="' + escapeAttr(val) + '" placeholder="' + ph + '"></div>';
        }).join('');
        openModal('crudModal');
        if (cfg.fields.some(function(f){ return f.type === 'cascade'; })) fillCascade(mod, row);
    }

    // 表单内所属分类级联
    function onCascadeChange(level) {
        var mod = _crudActiveModule;
        if (!mod) return;
        loadCatTree(mod._cfg.catModule, function(tree) {
            var n1 = tree.find(function(n){ return n.id === document.getElementById('f_cat1').value; }) || null;
            if (level === 1) {
                fillSelect('f_cat2', n1 ? (n1.children || []) : [], '二级分类');
                fillSelect('f_cat3', [], '三级分类');
            } else if (level === 2) {
                var n2 = (n1 ? (n1.children || []) : []).find(function(n){ return n.id === document.getElementById('f_cat2').value; }) || null;
                fillSelect('f_cat3', n2 ? (n2.children || []) : [], '三级分类');
            }
        });
    }
    function fillCascade(mod, row) {
        loadCatTree(mod._cfg.catModule, function(tree) {
            fillSelect('f_cat1', tree, '一级分类');
            // 编辑回填：three 模式按 categoryId1/2/3；single 模式按 categoryId 找路径
            var c1 = '', c2 = '', c3 = '';
            if (row) {
                if (mod._cfg.catMode === 'single') {
                    var target = row.categoryId || '';
                    (function find(list, path) {
                        for (var i = 0; i < list.length; i++) {
                            var n = list[i];
                            var p = path.concat(n.id);
                            if (n.id === target) { c1 = p[0] || ''; c2 = p[1] || ''; c3 = p[2] || ''; return true; }
                            if (n.children && find(n.children, p)) return true;
                        }
                        return false;
                    })(tree, []);
                } else {
                    c1 = row.categoryId1 || ''; c2 = row.categoryId2 || ''; c3 = row.categoryId3 || '';
                }
            }
            if (c1) {
                document.getElementById('f_cat1').value = c1;
                var n1 = tree.find(function(n){ return n.id === c1; }) || null;
                fillSelect('f_cat2', n1 ? (n1.children || []) : [], '二级分类');
                if (c2) {
                    document.getElementById('f_cat2').value = c2;
                    var n2 = (n1 ? (n1.children || []) : []).find(function(n){ return n.id === c2; }) || null;
                    fillSelect('f_cat3', n2 ? (n2.children || []) : [], '三级分类');
                    if (c3) document.getElementById('f_cat3').value = c3;
                } else if (mod._cfg.catMode === 'single' && c3) {
                    // single 且选中的就是一级节点
                }
            }
        });
    }

    // === 定义各模块 ===
    defineCrudModule({
        name: 'url', panel: 'urls', keywordId: 'urls-keyword',
        listApi: '/rs/url/list', createApi: '/rs/url',
        catModule: 'url', catMode: 'three',
        updateApi: '/rs/url/{id}', deleteApi: '/rs/url/{id}',
        batchDeleteApi: '/rs/url/batch-delete', importModule: 'url',
        tableId: 'urls-table', tbodyId: 'urls-tbody', pageId: 'urls-pagination',
        checkAllId: 'urls-check-all', batchDelBtnId: 'urls-batch-del',
        rowActions: ['open','edit','delete'],
        columns: [{key:'name',label:'名称'},{key:'url',label:'地址'},{key:'remark',label:'备注'},{key:'updatedAt',label:'更新时间'}],
        fields: [
            {key:'name',label:'名称',required:true},
            {key:'url',label:'地址',required:true,placeholder:'https://...'},
            {key:'category',label:'所属分类',type:'cascade'},
            {key:'remark',label:'备注',type:'textarea'}
        ]
    });

    defineCrudModule({
        name: 'online-doc', panel: 'online-docs', keywordId: 'online-docs-keyword',
        listApi: '/rs/online-doc/list', createApi: '/rs/online-doc',
        catModule: 'onlineDoc', catMode: 'three',
        updateApi: '/rs/online-doc/{id}', deleteApi: '/rs/online-doc/{id}',
        batchDeleteApi: '/rs/online-doc/batch-delete', importModule: 'onlineDoc',
        tableId: 'online-docs-table', tbodyId: 'online-docs-tbody', pageId: 'online-docs-pagination',
        checkAllId: 'online-docs-check-all', batchDelBtnId: 'online-docs-batch-del',
        rowActions: ['open','edit','delete'],
        columns: [{key:'name',label:'名称'},{key:'url',label:'地址'},{key:'remark',label:'备注'},{key:'updatedAt',label:'更新时间'}],
        fields: [
            {key:'name',label:'名称',required:true},
            {key:'url',label:'在线文档地址',required:true},
            {key:'category',label:'所属分类',type:'cascade'},
            {key:'remark',label:'备注',type:'textarea'}
        ]
    });

    defineCrudModule({
        name: 'local-doc', panel: 'local-docs', keywordId: 'local-docs-keyword',
        listApi: '/rs/local-doc/list', createApi: '/rs/local-doc',
        catModule: 'localDoc', catMode: 'three',
        updateApi: '/rs/local-doc/{id}', deleteApi: '/rs/local-doc/{id}',
        batchDeleteApi: '/rs/local-doc/batch-delete', importModule: 'localDoc',
        tableId: 'local-docs-table', tbodyId: 'local-docs-tbody', pageId: 'local-docs-pagination',
        checkAllId: 'local-docs-check-all', batchDelBtnId: 'local-docs-batch-del',
        rowActions: ['preview','open','edit','delete'], hasLocalFile: true,
        columns: [{key:'name',label:'名称'},{key:'filePath',label:'路径'},{key:'fileType',label:'类型'},{key:'fileSize',label:'大小'},{key:'exists',label:'存在'},{key:'updatedAt',label:'更新时间'}],
        fields: [
            {key:'name',label:'名称 (留空自动用文件名)'},
            {key:'filePath',label:'文件路径',required:true,placeholder:'C:/docs/report.pdf'},
            {key:'category',label:'所属分类',type:'cascade'},
            {key:'remark',label:'备注',type:'textarea'}
        ]
    });

    defineCrudModule({
        name: 'md', panel: 'md-files', keywordId: 'md-files-keyword',
        listApi: '/rs/md/list', createApi: '/rs/md',
        catModule: 'md', catMode: 'single',
        updateApi: '/rs/md/{id}', deleteApi: '/rs/md/{id}',
        batchDeleteApi: '/rs/md/batch-delete', importModule: 'md',
        tableId: 'md-files-table', tbodyId: 'md-files-tbody', pageId: 'md-files-pagination',
        checkAllId: 'md-files-check-all', batchDelBtnId: 'md-files-batch-del',
        rowActions: ['viewMd','open','edit','delete'], hasLocalFile: true,
        columns: [{key:'name',label:'名称'},{key:'filePath',label:'路径'},{key:'exists',label:'存在'},{key:'updatedAt',label:'更新时间'}],
        fields: [
            {key:'name',label:'名称 (留空自动用文件名)'},
            {key:'filePath',label:'MD 文件路径',required:true},
            {key:'category',label:'所属分类',type:'cascade'},
            {key:'remark',label:'备注'}
        ]
    });

    defineCrudModule({
        name: 'ai-preset', panel: 'ai-presets', keywordId: 'ai-presets-keyword',
        listApi: '/rs/ai-preset/list', createApi: '/rs/ai-preset',
        updateApi: '/rs/ai-preset/{id}', deleteApi: '/rs/ai-preset/{id}',
        batchDeleteApi: '/rs/ai-preset/batch-delete', importModule: 'aiPreset',
        tableId: 'ai-presets-table', tbodyId: 'ai-presets-tbody', pageId: 'ai-presets-pagination',
        checkAllId: 'ai-presets-check-all', batchDelBtnId: 'ai-presets-batch-del',
        rowActions: ['edit','delete'],
        columns: [{key:'name',label:'名称'},{key:'description',label:'描述'},{key:'isDefault',label:'默认'},{key:'enabled',label:'启用'},{key:'updatedAt',label:'更新时间'}],
        fields: [
            {key:'name',label:'预设名称',required:true},
            {key:'description',label:'描述'},
            {key:'formatPrompt',label:'提示词 (纯文本)',required:true,type:'textarea',placeholder:'你是... 请按以下格式输出...'},
            {key:'enabled',label:'启用',type:'checkbox'},
            {key:'isDefault',label:'设为默认',type:'checkbox'}
        ]
    });

    // === Modal Save 绑定 ===
    document.getElementById('crudModalSave').addEventListener('click', function() {
        if (_crudActiveModule) _crudActiveModule.save();
    });

    // === 批量导入 ===
    function doImport() {
        var m = document.getElementById('importModal');
        var moduleName = m.dataset.module;
        var fmt = document.getElementById('importFormat').value;
        var text = document.getElementById('importText').value;
        if (!text.trim()) { showToast('error', '请输入导入内容'); return; }
        apiRequest('POST', '/rs/import/' + moduleName, { format: fmt, text: text }, function(err, resp) {
            if (err) { showToast('error', '导入失败: ' + err); return; }
            showToast('success', '导入完成: 成功 ' + resp.success + ', 失败 ' + resp.fail);
            closeModal('importModal');
            // 刷新相关模块
            var modMap = { url:'url', onlineDoc:'online-doc', localDoc:'local-doc', md:'md', aiPreset:'ai-preset' };
            var mod = crudModules[modMap[moduleName]];
            if (mod) mod.reload();
        });
    }

    // === Markdown 查看 ===
    var _mdViewId = null, _mdEditMode = false, _mdContent = '';
    function openMdView(id) {
        _mdViewId = id;
        _mdEditMode = false;
        apiRequest('GET', '/rs/md/' + id, null, function(err, resp) {
            if (err) { showToast('error', '加载失败: ' + err); return; }
            _mdContent = resp.content;
            document.getElementById('mdViewTitle').textContent = resp.name;
            renderMdView();
            openModal('mdViewModal');
        });
    }
    function toggleMdViewMode() {
        _mdEditMode = !_mdEditMode;
        renderMdView();
    }
    function renderMdView() {
        var el = document.getElementById('mdViewContent');
        if (_mdEditMode) {
            el.innerHTML = '<textarea class="form-control" id="mdEditText" style="width:100%;height:100%;min-height:300px;font-family:monospace">' + escapeHtml(_mdContent) + '</textarea>';
        } else {
            el.innerHTML = '<pre style="white-space:pre-wrap;font-family:monospace">' + escapeHtml(_mdContent) + '</pre>';
        }
    }
    function saveMdEdit() {
        if (!_mdEditMode || !_mdViewId) return;
        var ta = document.getElementById('mdEditText');
        var newContent = ta.value;
        apiRequest('POST', '/rs/md/' + _mdViewId + '/save', { content: newContent }, function(err, resp) {
            if (err) { showToast('error', '保存失败: ' + err); return; }
            _mdContent = newContent;
            _mdEditMode = false;
            showToast('success', '已保存');
            renderMdView();
        });
    }

    // === 线下文档预览（简单实现：文本直接返回，其他提示外部打开）===
    function openDocPreview(id) {
        apiRequest('GET', '/rs/local-doc/preview/' + id, null, function(err, resp) {
            if (err) { showToast('error', '加载失败: ' + err); return; }
            if (resp.type === 'text') {
                alert('文件内容预览:\n\n' + resp.text.substring(0, 2000));
            } else {
                window.open(resp.downloadUrl, '_blank');
            }
        });
    }

    // === 菜单设置（需求 6+8：名称修改 / 分组 / 排序 / 显隐） ===
    var MENU_GROUPS = [
        {key:'resources', label:'资源管理'},
        {key:'ai', label:'AI 能力'},
        {key:'system', label:'系统设置'}
    ];

    function loadMenuSettings() {
        apiRequest('GET', '/rs/menu/list', null, function(err, resp) {
            var area = document.getElementById('menu-list-area');
            if (err) { area.innerHTML = '<div style="color:var(--danger)">菜单加载失败: ' + escapeHtml(err) + '</div>'; return; }
            var html = (resp || []).map(function(g) {
                var rows = g.items.map(function(it) {
                    var opts = MENU_GROUPS.map(function(mg) {
                        return '<option value="' + mg.key + '"' + (mg.key === it.groupKey ? ' selected' : '') + '>' + mg.label + '</option>';
                    }).join('');
                    return '<tr>' +
                        '<td style="padding:6px"><input type="checkbox" data-menu-check="' + escapeAttr(it.id) + '"></td>' +
                        '<td style="padding:6px"><input class="form-control" id="mn_' + it.id + '" value="' + escapeAttr(it.displayName) + '" style="padding:4px 8px;font-size:.82rem;"></td>' +
                        '<td style="padding:6px"><input class="form-control" id="mk_' + it.id + '" value="' + escapeAttr(it.menuKey) + '" disabled style="padding:4px 8px;font-size:.78rem;color:var(--text-light);"></td>' +
                        '<td style="padding:6px"><select class="form-control" id="mg_' + it.id + '" style="padding:4px 8px;font-size:.8rem;">' + opts + '</select></td>' +
                        '<td style="padding:6px;width:70px"><input class="form-control" id="ms_' + it.id + '" type="number" value="' + (it.sort || 0) + '" style="padding:4px 8px;font-size:.8rem;"></td>' +
                        '<td style="padding:6px;text-align:center"><input type="checkbox" id="mv_' + it.id + '"' + (it.visible ? ' checked' : '') + '></td>' +
                        '<td style="padding:6px"><button class="btn btn-primary btn-sm" onclick="saveMenuOne(\'' + it.id + '\')">保存</button></td>' +
                        '</tr>';
                }).join('');
                return '<div style="margin-bottom:14px;">' +
                    '<div style="font-size:.78rem;font-weight:600;color:var(--primary);margin-bottom:6px;">' + escapeHtml(g.groupLabel) + '</div>' +
                    '<table class="table" style="width:100%;border-collapse:collapse;border:1px solid var(--border);border-radius:6px;">' +
                    '<thead><tr style="background:var(--sidebar-hover);font-size:.78rem;color:var(--text-secondary);">' +
                    '<th style="width:32px"></th><th>菜单名称</th><th>菜单 Key</th><th style="width:120px;">所属分组</th><th style="width:80px;">排序</th><th style="width:56px;">显示</th><th style="width:70px;"></th>' +
                    '</tr></thead><tbody>' + rows + '</tbody></table></div>';
            }).join('');
            area.innerHTML = html || '<div style="color:var(--text-light)">暂无菜单配置</div>';
        });
    }

    function saveMenuOne(id) {
        var name = document.getElementById('mn_' + id).value.trim();
        if (!name) { showToast('error', '菜单名称不能为空'); return; }
        var body = {
            displayName: name,
            groupKey: document.getElementById('mg_' + id).value,
            sort: parseInt(document.getElementById('ms_' + id).value, 10) || 0,
            visible: document.getElementById('mv_' + id).checked ? 1 : 0
        };
        apiRequest('PUT', '/rs/menu/' + id, body, function(err) {
            if (err) { showToast('error', '保存失败: ' + err); return; }
            showToast('success', '菜单已更新');
            loadMenuSettings();
            loadAndRenderMenu();
        });
    }

    crudModules['menu'] = {
        load: loadMenuSettings,
        reload: loadMenuSettings,
        batchUpdate: function() {
            var ids = Array.prototype.slice.call(document.querySelectorAll('#menu-list-area input[data-menu-check]:checked'))
                .map(function(c) { return c.getAttribute('data-menu-check'); });
            if (!ids.length) { showToast('info', '请先勾选要批量修改的菜单'); return; }
            var g = prompt('批量设置所属分组 (resources / ai / system):', 'resources');
            if (g === null) return;
            g = g.trim();
            if (!MENU_GROUPS.some(function(m){ return m.key === g; })) { showToast('error', '分组名无效'); return; }
            var s = prompt('批量设置排序值 (数字):', '1');
            if (s === null) return;
            apiRequest('POST', '/rs/menu/batch-update', { ids: ids, groupKey: g, sort: parseInt(s, 10) || 0 }, function(err) {
                if (err) { showToast('error', '批量更新失败: ' + err); return; }
                showToast('success', '已更新 ' + ids.length + ' 个菜单');
                loadMenuSettings();
                loadAndRenderMenu();
            });
        }
    };
    crudModules['menu-settings'] = crudModules['menu'];   // 菜单面板 key 与模块 key 对齐

    // === 菜单重置 ===
    function openMenuResetModal() {
        if (!confirm('确认恢复所有菜单为默认配置?\n\n这将覆盖你所有的自定义菜单名称、分组和排序.')) return;
        apiRequest('POST', '/rs/menu/reset', null, function(err, resp) {
            if (err) { showToast('error', err); return; }
            showToast('success', '已恢复默认');
            loadAndRenderMenu();
        });
    }

    // =================== 登录认证 ===================
    var appStarted = false;

    function showLoginOverlay(msg) {
        var ov = document.getElementById('loginOverlay');
        if (ov) ov.style.display = 'flex';
        var err = document.getElementById('loginError');
        if (err) err.textContent = msg || '';
    }

    function hideLoginOverlay() {
        var ov = document.getElementById('loginOverlay');
        if (ov) ov.style.display = 'none';
        var err = document.getElementById('loginError');
        if (err) err.textContent = '';
    }

    function doLogin() {
        var u = (document.getElementById('loginUsername').value || '').trim();
        var p = document.getElementById('loginPassword').value || '';
        var errBox = document.getElementById('loginError');
        if (!u || !p) { errBox.textContent = '请输入账号和密码'; return; }
        var btn = document.getElementById('loginBtn');
        btn.disabled = true; btn.textContent = '登录中...';
        apiRequest('POST', '/rs/auth/login', { username: u, password: p }, function(err, resp) {
            btn.disabled = false; btn.textContent = '登 录';
            if (err) { errBox.textContent = err; return; }
            document.getElementById('loginPassword').value = '';
            hideLoginOverlay();
            setCurrentAccount(resp && resp.username);
            startApp();
        });
    }

    function doLogout() {
        apiRequest('POST', '/rs/auth/logout', null, function() {
            location.reload();
        });
    }

    function setCurrentAccount(name) {
        var el = document.getElementById('currentAccount');
        if (el && name) el.textContent = name;
    }

    function changeAccount() {
        var oldP = document.getElementById('oldPassword').value || '';
        var newU = (document.getElementById('newUsername').value || '').trim();
        var newP = document.getElementById('newPassword').value || '';
        var confP = document.getElementById('confirmPassword').value || '';
        if (!oldP || !newP) { showToast('error', '当前密码和新密码必填'); return; }
        if (newP.length < 6) { showToast('error', '新密码至少 6 位'); return; }
        if (newP !== confP) { showToast('error', '两次输入的新密码不一致'); return; }
        apiRequest('POST', '/rs/auth/change-password',
            { oldPassword: oldP, newPassword: newP, newUsername: newU },
            function(err, resp) {
                if (err) { showToast('error', '修改失败: ' + err); return; }
                ['oldPassword', 'newPassword', 'confirmPassword', 'newUsername'].forEach(function(id) {
                    document.getElementById(id).value = '';
                });
                setCurrentAccount(resp && resp.username);
                showToast('success', resp.message || '账号密码修改成功');
            });
    }
    // Enter 登录
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && document.getElementById('loginOverlay').style.display !== 'none') {
            doLogin();
        }
    });

    // =================== 初始化 ===================
    function startApp() {
        if (appStarted) return;
        appStarted = true;
        setTimeout(function() {
            loadAndRenderMenu();
            loadAiPresets();
            setTimeout(function() {
                // 初始加载各模块（在其 panel 显示时才加载）
                ['url','online-doc','local-doc','md','ai-preset'].forEach(function(n) {
                    if (crudModules[n]) {
                        // 预加载第一页 + 初始化分类筛选
                        if (crudModules[n]._cfg && crudModules[n]._cfg.catModule) initCatFilter(n);
                        crudModules[n].load();
                    }
                });
            }, 500);
        }, 300);
    }

    // 启动门槛：先校验登录态（cookie token 24h 有效），未登录只显示登录页
    (function() {
        var ov = document.getElementById('loginOverlay');
        if (ov) ov.style.display = 'flex';
        apiRequest('GET', '/rs/auth/check', null, function(err, resp) {
            if (err) { showLoginOverlay(''); return; }
            hideLoginOverlay();
            setCurrentAccount(resp && resp.username);
            startApp();
        });
    })();

    // 辅助 escape
    function escapeAttr(s) {
        return (s || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
