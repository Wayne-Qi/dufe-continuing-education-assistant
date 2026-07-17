// ==UserScript==
// @name         东北财经大学继续教育在线学习
// @namespace    http://tampermonkey.net/
// @version      0.1.4.1
// @description  课程自动播放助手 - 全自动循环学习
// @author       Qi
// @match        *://trahljkj.edufe.cn/*
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // =============== 配置 ===============
    var CONFIG = {
        checkInterval: 3000,
        returnDelay: 2000,
        startDelay: 3000,
        completedThreshold: 100,
        popupCheckInterval: 2000,
        allCompletedStopCount: 3,
        heartbeatInterval: 3000,
        pageDetectInterval: 1000,
        panelDefaultWidth: 400,
        logMinHeight: 100,
        logMaxHeightRatio: 0.8,
        videoMonitorInterval: 1000,
        scanInterval: 5000,
        logMaxRows: 30,
        dashUpdateInterval: 1500,
        chapterCheckDelay: 500,
        reinitGuardDelay: 500,
        initDelay: 1500,
        visibilityResumeDelay: 600,
        playStateCheckDelay: 1000,
        popupMaxRetry: 10,
        observerDebounce: 500,
    };

    // =============== 状态 ===============
    var enabled            = true;
    var allCompletedCount  = 0;
    var currentPageType    = 'unknown';
    var popupRetryCount    = 0;
    var timers = { check: null, scan: null, popup: null, heartbeat: null, pageDetect: null, videoMonitor: null };
    var videoControlInstance = null;
    var panel              = null;
    var panelRefs          = {};
    var isInitialized      = false;
    var pageObserver       = null;
    var lastVideoSrc       = '';
    var lastReinitTime     = 0;

    var dash = {
        chapterCompleted: 0,
        chapterTotal: 0,
        chapterTitle: '',
        lastChapterCompleted: 0,
        endedCount: 0,
        autoDetectChapters: true,
    };

    // =============== 工具函数 ===============
    function formatTime(date) {
        var h = String(date.getHours()).padStart(2, '0');
        var m = String(date.getMinutes()).padStart(2, '0');
        var s = String(date.getSeconds()).padStart(2, '0');
        return h + ':' + m + ':' + s;
    }

    function pad2(n) { return String(Math.floor(n)).padStart(2, '0'); }
    function formatDuration(totalSec) {
        if (totalSec <= 0) return '0:00';
        var h = Math.floor(totalSec / 3600);
        var m = Math.floor((totalSec % 3600) / 60);
        var s = Math.floor(totalSec % 60);
        if (h > 0) return h + ':' + pad2(m) + ':' + pad2(s);
        return m + ':' + pad2(s);
    }


    // =============== 面板持久化 ===============
    var PANEL_STORAGE_KEY = 'dc_panel_state';
    function loadPanelState() {
        try {
            var raw = localStorage.getItem(PANEL_STORAGE_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) { return {}; }
    }
    function savePanelState(state) {
        try {
            var current = loadPanelState();
            for (var k in state) current[k] = state[k];
            localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(current));
        } catch (e) {}
    }


    // =============== 日志持久化 ===============
    var LOG_STORAGE_KEY = 'dc_logs';
    var logEntries = [];

    function saveLogs() {
        try {
            localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(logEntries.slice(-CONFIG.logMaxRows)));
        } catch (e) {}
    }

    function loadLogs() {
        try {
            var raw = localStorage.getItem(LOG_STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) { return []; }
    }

    function renderLogs() {
        var listEl = panelRefs.logList;
        if (!listEl) return;
        listEl.innerHTML = '';
        if (logEntries.length === 0) {
            listEl.innerHTML = '<div class="log-empty">暂无日志</div>';
            return;
        }
        for (var i = 0; i < logEntries.length; i++) {
            var entry = logEntries[i];
            var item = document.createElement('div');
            item.className = 'log-item';

            var timeSpan = document.createElement('span');
            timeSpan.className = 'log-time';
            timeSpan.textContent = entry.time;

            var textSpan = document.createElement('span');
            textSpan.className = 'log-text ' + entry.level;
            textSpan.textContent = entry.text;

            item.appendChild(timeSpan);
            item.appendChild(textSpan);

            if (entry.count > 1) {
                var countSpan = document.createElement('span');
                countSpan.className = 'log-count';
                countSpan.style.cssText = 'color:#9ca3af;font-size:12px;margin-left:6px;';
                countSpan.textContent = '(x' + entry.count + ')';
                item.appendChild(countSpan);
            }

            listEl.appendChild(item);
        }
        listEl.scrollTop = listEl.scrollHeight;
    }

    // =============== 面板创建 ===============
    var CSS = ''
    + '#dc-panel{position:fixed;top:10px;left:10px;z-index:999999;'
    + 'width:380px;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;'
    + 'font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",\"Microsoft YaHei\",sans-serif;'
    + 'font-size:14px;color:#374151;box-shadow:0 8px 32px rgba(0,0,0,0.1);'
    + 'user-select:none;overflow:hidden;display:flex;flex-direction:column;max-height:80vh;'
    + 'transition:transform 0.25s ease,width 0.2s;}'
    + '#dc-panel.dock-hidden{transform:translateX(calc(-100% + 8px));}'
    + '#dc-panel.dock-hidden.dock-visible{transform:translateX(0);}'
    + '#dc-panel.minimized #dc-progress-section,#dc-panel.minimized #dc-log-section{display:none;}\n'
    + '#dc-panel *{box-sizing:border-box;margin:0;padding:0;}\n'
    + '#dc-header{cursor:move;padding:10px 12px;display:flex;justify-content:space-between;align-items:center;'
    + 'background:linear-gradient(135deg,#f9fafb,#f3f4f6);border-bottom:1px solid #f3f4f6;}\n'
    + '#dc-title{font-size:14px;font-weight:600;color:#111827;}\n'
    + '#dc-header-actions{display:flex;gap:6px;align-items:center;}\n'
    + '#dc-minimize-btn{width:22px;height:22px;border-radius:6px;display:flex;align-items:center;justify-content:center;'
    + 'font-size:16px;line-height:1;color:#6b7280;background:#ffffff;border:1px solid #e5e7eb;cursor:pointer;transition:all 0.15s;}\n'
    + '#dc-minimize-btn:hover{background:#f3f4f6;color:#111827;}\n'
    + '#dc-status{padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;cursor:default;}\n'
    + '#dc-status.playing{background:#dcfce7;color:#166534;}\n'
    + '#dc-status.paused{background:#fee2e2;color:#991b1b;}\n'
    + '#dc-status.stopped{background:#f3f4f6;color:#6b7280;}\n'
    + '#dc-progress-section{padding:12px;}\n'
    + '#dc-progress-bar{height:6px;background:#e5e7eb;border-radius:3px;overflow:hidden;margin-bottom:10px;}\n'
    + '#dc-progress-fill{height:100%;background:linear-gradient(90deg,#22c55e,#4ade80);border-radius:3px;'
    + 'transition:width 0.4s ease;width:0%;}\n'
    + '#dc-progress-fill.done{background:linear-gradient(90deg,#3b82f6,#60a5fa);}\n'
    + '#dc-time-row{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;}\n'
    + '#dc-current-time{font-size:26px;font-weight:700;color:#111827;font-variant-numeric:tabular-nums;letter-spacing:-0.5px;}\n'
    + '#dc-total-time{font-size:15px;font-weight:500;color:#9ca3af;font-variant-numeric:tabular-nums;}\n'
    + '#dc-eta{font-size:13px;color:#6b7280;text-align:right;}\n'
    + '#dc-eta span{font-weight:600;color:#7c3aed;}\n'
    + '#dc-eta.done span{color:#16a34a;}\n'
    + '#dc-log-section{border-top:1px solid #f3f4f6;background:#fafafa;display:flex;flex-direction:column;'
    + 'flex:1;min-height:0;transition:min-height 0.2s;position:relative;}\n'
    + '#dc-log-section.collapsed{min-height:0;}\n'
    + '#dc-log-section.collapsed #dc-log-list{display:none;}\n'
    + '#dc-log-header{cursor:pointer;padding:10px 12px;display:flex;justify-content:space-between;align-items:center;'
    + 'background:linear-gradient(135deg,#f9fafb,#e5e7eb);border-bottom:1px solid #e5e7eb;}\n'
    + '#dc-log-title{font-size:13px;font-weight:600;color:#374151;display:flex;align-items:center;gap:8px;}\n'
    + '#dc-log-title::before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;'
    + 'background:linear-gradient(135deg,#7c3aed,#a78bfa);box-shadow:0 0 0 3px rgba(124,58,237,0.15);transition:transform 0.2s;}\n'
    + '#dc-log-section.collapsed #dc-log-title::before{transform:scale(0.7);}\n'
    + '#dc-log-actions{display:flex;gap:0;align-items:center;background:#ffffff;border-radius:8px;'
    + 'padding:2px;box-shadow:0 1px 3px rgba(0,0,0,0.06);border:1px solid #e5e7eb;}\n'
    + '#dc-log-clear,#dc-log-toggle,#dc-log-pause{cursor:pointer;border:none;background:transparent;font-size:12px;'
    + 'padding:5px 10px;border-radius:6px;color:#4b5563;transition:all 0.15s;position:relative;}\n'
    + '#dc-log-clear:not(:last-child)::after,#dc-log-toggle:not(:last-child)::after,#dc-log-pause:not(:last-child)::after{'
    + 'content:"";position:absolute;right:0;top:20%;bottom:20%;width:1px;background:#e5e7eb;}\n'
    + '#dc-log-pause{color:#92400e;font-weight:600;}\n'
    + '#dc-log-pause:hover{background:#fef3c7;color:#b45309;}\n'
    + '#dc-log-pause.paused{color:#166534;background:#dcfce7;}\n'
    + '#dc-log-pause.paused:hover{background:#bbf7d0;color:#15803d;}\n'
    + '#dc-log-clear:hover{background:#fee2e2;color:#991b1b;}\n'
    + '#dc-log-toggle:hover{background:#f3f4f6;color:#374151;}\n'
    + '#dc-log-list{flex:1;overflow-y:auto;max-height:180px;padding:8px 12px;font-size:14px;line-height:1.6;color:#374151;background:#ffffff;}\n'
    + '#dc-log-list::-webkit-scrollbar{width:5px;}\n'
    + '#dc-log-list::-webkit-scrollbar-thumb{background:#d1d5db;border-radius:3px;}\n'
    + '#dc-log-list::-webkit-scrollbar-track{background:transparent;}\n'
    + '#dc-log-list .log-empty{color:#9ca3af;font-size:13px;text-align:center;padding:16px 0;}\n'
    + '#dc-log-list .log-item{padding:4px 0;border-bottom:1px solid #f3f4f6;word-break:break-all;}\n'
    + '#dc-log-list .log-item:last-child{border-bottom:none;}\n'
    + '#dc-log-list .log-time{color:#9ca3af;font-size:12px;margin-right:8px;font-variant-numeric:tabular-nums;}\n'
    + '#dc-log-list .log-text{color:#374151;font-weight:500;}\n'
    + '#dc-log-list .log-text.info{color:#374151;}\n'
    + '#dc-log-list .log-text.warn{color:#d97706;}\n'
    + '#dc-log-list .log-text.error{color:#dc2626;}\n'
    + '#dc-log-list .log-text.success{color:#16a34a;}\n'
    + '#dc-log-list .log-count{color:#9ca3af;font-size:12px;margin-left:6px;}\n'
    + '#dc-resize-handle{position:absolute;right:0;top:0;bottom:0;width:6px;cursor:ew-resize;z-index:10;}\n'
    + '#dc-resize-handle:hover{background:rgba(124,58,237,0.1);}\n'
    + '#dc-log-resize-handle{position:absolute;left:0;right:0;bottom:0;height:6px;cursor:ns-resize;z-index:10;background:transparent;}\n'
    + '#dc-log-resize-handle:hover{background:rgba(124,58,237,0.1);}\n';
    function createPanel() {
        if (document.getElementById('dc-panel')) return;
        GM_addStyle(CSS);

        var savedState = loadPanelState();
        var isDockHidden = false;

        var div = document.createElement('div');
        div.id = 'dc-panel';
        if (savedState.width) div.style.width = savedState.width + 'px';
        if (savedState.left) div.style.left = savedState.left + 'px';
        if (savedState.top) div.style.top = savedState.top + 'px';
        if (savedState.minimized) div.classList.add('minimized');
        if (savedState.docked) {
            div.classList.add('dock-hidden');
            isDockHidden = true;
        }

        div.innerHTML =
            '<div id="dc-resize-handle"></div>' +
            '<div id="dc-header">' +
            '<span id="dc-title">🎓 东北财经在线教育学习助手 by齐</span>' +
            '<div id="dc-header-actions">' +
            '<span id="dc-status" class="stopped">就绪</span>' +
            '<button id="dc-minimize-btn" title="最小化">−</button>' +
            '</div>' +
            '</div>' +
            '<div id="dc-progress-section">' +
            '<div id="dc-progress-bar"><div id="dc-progress-fill"></div></div>' +
            '<div id="dc-time-row">' +
            '<span id="dc-current-time">--:--</span>' +
            '<span id="dc-total-time">--:--</span>' +
            '</div>' +
            '<div id="dc-eta">预计 <span>--:--</span> 结束</div>' +
            '</div>' +
            '<div id="dc-log-section">' +
            '<div id="dc-log-resize-handle"></div>' +
            '<div id="dc-log-header">' +
            '<span id="dc-log-title">📋 事件日志</span>' +
            '<div id="dc-log-actions">' +
            '<button id="dc-log-pause" title="暂停脚本">⏸ 暂停</button>' +
            '<button id="dc-log-clear">清空</button>' +
            '<button id="dc-log-toggle">收起</button>' +
            '</div>' +
            '</div>' +
            '<div id="dc-log-list"><div class="log-empty">暂无日志</div></div>' +
            '</div>';
        document.body.appendChild(div);

        // 宽度拖拽
        var resizeHandle = div.querySelector('#dc-resize-handle');
        var resizing = false, resizeStartX = 0, resizeStartW = 0;
        resizeHandle.addEventListener('mousedown', function (e) {
            e.preventDefault();
            e.stopPropagation();
            resizing = true;
            resizeStartX = e.clientX;
            resizeStartW = div.offsetWidth;
            div.style.transition = 'none';
            document.body.style.cursor = 'ew-resize';
            function onResizeMove(ev) {
                if (!resizing) return;
                var newW = resizeStartW + (ev.clientX - resizeStartX);
                newW = Math.max(300, Math.min(newW, window.innerWidth - 24));
                div.style.width = newW + 'px';
            }
            function onResizeUp() {
                resizing = false;
                div.style.transition = '';
                document.body.style.cursor = '';
                document.removeEventListener('mousemove', onResizeMove);
                document.removeEventListener('mouseup', onResizeUp);
                savePanelState({ width: div.offsetWidth });
            }
            document.addEventListener('mousemove', onResizeMove);
            document.addEventListener('mouseup', onResizeUp);
        });

        // 标题拖动
        var header = div.querySelector('#dc-header');
        var isDragging = false, dragX = 0, dragY = 0;
        header.addEventListener('mousedown', function (e) {
            if (e.target.closest('button')) return;
            if (isDockHidden) {
                dockReset();
                var rect = div.getBoundingClientRect();
                dragX = e.clientX - rect.left;
                dragY = e.clientY - rect.top;
            }
            isDragging = true;
            var rect = div.getBoundingClientRect();
            dragX = e.clientX - rect.left;
            dragY = e.clientY - rect.top;
            div.style.opacity = '0.9';
            function onMove(ev) {
                if (!isDragging) return;
                var x = ev.clientX - dragX;
                var y = ev.clientY - dragY;
                div.style.left = Math.max(0, Math.min(x, window.innerWidth - div.offsetWidth)) + 'px';
                div.style.top = Math.max(0, Math.min(y, window.innerHeight - div.offsetHeight)) + 'px';
            }
            function onUp() {
                isDragging = false;
                div.style.opacity = '1';
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                savePanelState({ left: parseInt(div.style.left || 0), top: parseInt(div.style.top || 0) });
                checkDock();
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        // 最小化
        var minimizeBtn = div.querySelector('#dc-minimize-btn');
        if (savedState.minimized) {
            minimizeBtn.textContent = '+';
            minimizeBtn.title = '展开';
        }
        function dockHide() {
            if (isDockHidden) return;
            div.classList.remove('minimized');
            div.classList.add('dock-hidden');
            isDockHidden = true;
            minimizeBtn.textContent = '−';
            minimizeBtn.title = '最小化';
            savePanelState({ docked: true, minimized: false });
        }
        function dockShow() {
            if (!isDockHidden) return;
            div.classList.add('dock-visible');
        }
        function dockReset() {
            if (!isDockHidden) return;
            div.classList.remove('dock-hidden', 'dock-visible');
            isDockHidden = false;
            savePanelState({ docked: false });
        }
        function checkDock() {
            var left = parseInt(div.style.left || 0);
            if (left < 20) {
                dockHide();
            } else {
                dockReset();
            }
        }
        minimizeBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            if (isDockHidden) dockReset();
            var minimized = div.classList.toggle('minimized');
            minimizeBtn.textContent = minimized ? '+' : '−';
            minimizeBtn.title = minimized ? '展开' : '最小化';
            savePanelState({ minimized: minimized });
        });

        // dock 边缘隐藏：鼠标进入显示，离开隐藏
        div.addEventListener('mouseenter', function () {
            if (isDockHidden) dockShow();
        });
        div.addEventListener('mouseleave', function () {
            if (isDockHidden) {
                setTimeout(function () {
                    div.classList.remove('dock-visible');
                }, 200);
            }
        });

        // 日志折叠
        var logSection = div.querySelector('#dc-log-section');
        var logHeader = div.querySelector('#dc-log-header');
        var logToggle = div.querySelector('#dc-log-toggle');
        var logList = div.querySelector('#dc-log-list');
        var logClear = div.querySelector('#dc-log-clear');

        function toggleLog() {
            logSection.classList.toggle('collapsed');
            var collapsed = logSection.classList.contains('collapsed');
            logToggle.textContent = collapsed ? '展开' : '收起';
        }

        logHeader.addEventListener('click', function (e) {
            if (e.target.closest('button')) return;
            toggleLog();
        });

        logToggle.addEventListener('click', function (e) {
            e.stopPropagation();
            toggleLog();
        });

        var logPause = div.querySelector('#dc-log-pause');
        function updatePauseButton() {
            if (!logPause) return;
            if (enabled) {
                logPause.textContent = '⏸ 暂停';
                logPause.title = '暂停脚本';
                logPause.classList.remove('paused');
            } else {
                logPause.textContent = '▶ 开始';
                logPause.title = '恢复脚本';
                logPause.classList.add('paused');
            }
        }
        logPause.addEventListener('click', function (e) {
            e.stopPropagation();
            enabled = !enabled;
            updatePauseButton();
            dashLog(enabled ? '▶' : '⏸', enabled ? '脚本已恢复' : '脚本已暂停');
            try { localStorage.setItem('dc_enabled', String(enabled)); } catch (err) {}
            if (enabled) {
                allCompletedCount = 0;
                popupRetryCount = 0;
                if (currentPageType === 'play' && !videoControlInstance) {
                    videoControlInstance = setupVideoControl();
                }
            } else {
                if (videoControlInstance) {
                    videoControlInstance.destroy();
                    videoControlInstance = null;
                }
            }
        });

        logClear.addEventListener('click', function (e) {
            e.stopPropagation();
            logEntries = [];
            lastLogMsg = '';
            lastLogCount = 1;
            renderLogs();
            saveLogs();
        });

        panel = div;
        // 日志区高度拖拽
        var logResizeHandle = div.querySelector('#dc-log-resize-handle');
        var logResizing = false, logResizeStartY = 0, logResizeStartH = 0;
        if (savedState.logHeight) {
            logList.style.maxHeight = savedState.logHeight + 'px';
            logList.style.height = savedState.logHeight + 'px';
        }
        logResizeHandle.addEventListener('mousedown', function (e) {
            e.preventDefault();
            e.stopPropagation();
            logResizing = true;
            logResizeStartY = e.clientY;
            logResizeStartH = logList.offsetHeight;
            document.body.style.cursor = 'ns-resize';
            function onLogResizeMove(ev) {
                if (!logResizing) return;
                var newH = logResizeStartH + (ev.clientY - logResizeStartY);
                newH = Math.max(60, Math.min(newH, 400));
                logList.style.maxHeight = newH + 'px';
                logList.style.height = newH + 'px';
            }
            function onLogResizeUp() {
                logResizing = false;
                document.body.style.cursor = '';
                document.removeEventListener('mousemove', onLogResizeMove);
                document.removeEventListener('mouseup', onLogResizeUp);
                savePanelState({ logHeight: logList.offsetHeight });
            }
            document.addEventListener('mousemove', onLogResizeMove);
            document.addEventListener('mouseup', onLogResizeUp);
        });


        panelRefs.panel        = div;
        panelRefs.status       = div.querySelector('#dc-status');
        panelRefs.progressFill = div.querySelector('#dc-progress-fill');
        panelRefs.currentTime  = div.querySelector('#dc-current-time');
        panelRefs.totalTime    = div.querySelector('#dc-total-time');
        panelRefs.eta          = div.querySelector('#dc-eta');
        panelRefs.etaSpan      = div.querySelector('#dc-eta span');
        panelRefs.logList      = logList;

        // 恢复日志
        logEntries = loadLogs();
        if (logEntries.length > 0) {
            var lastEntry = logEntries[logEntries.length - 1];
            lastLogMsg = lastEntry.text;
            lastLogCount = lastEntry.count || 1;
        }
        renderLogs();
        updatePauseButton();
    }

    var LOG_LEVELS = {
        '⚠️': 'warn', '❌': 'error',
        '✅': 'success', '🏁': 'success', '🚀': 'success',
        '▶️': 'info', '⏸': 'info', '🎬': 'info', '📋': 'info',
        '📖': 'info', '💬': 'info', '🔙': 'info', '🎯': 'info',
        '🔗': 'info', '📌': 'info', '🔇': 'info'
    };
    var lastLogMsg = '';
    var lastLogCount = 1;

    function dashLog(icon, msg) {
        var listEl = panelRefs.logList;
        if (!listEl) return;

        var time = formatTime(new Date());
        var shortTime = time.substring(0, 5);
        var level = LOG_LEVELS[icon] || 'info';

        var consoleMsg = '[' + time + '] ' + icon + ' ' + msg;
        if (level === 'warn') console.warn(consoleMsg);
        else if (level === 'error') console.error(consoleMsg);
        else console.log(consoleMsg);

        if (msg === lastLogMsg && logEntries.length > 0) {
            lastLogCount++;
            logEntries[logEntries.length - 1].count = lastLogCount;
            logEntries[logEntries.length - 1].time = shortTime;
            renderLogs();
            saveLogs();
            return;
        }
        lastLogMsg = msg;
        lastLogCount = 1;

        logEntries.push({
            time: shortTime,
            text: msg,
            level: level,
            count: 1
        });

        if (logEntries.length > CONFIG.logMaxRows) {
            logEntries.shift();
        }

        renderLogs();
        saveLogs();
    }

    function setStatus(el, cls, text) {
        if (!el) return;
        el.className = cls;
        el.textContent = text;
    }

    function updateProgress(currentSec, durationSec, paused) {
        if (!enabled) {
            if (panelRefs.status) setStatus(panelRefs.status, 'paused', '⏸ 脚本已暂停');
            if (panelRefs.eta && panelRefs.etaSpan) {
                panelRefs.etaSpan.textContent = '已暂停';
                panelRefs.eta.className = '';
            }
            return;
        }
        var pct = durationSec > 0 ? Math.min(100, Math.round(currentSec / durationSec * 100)) : 0;
        var fill = panelRefs.progressFill;
        var curEl = panelRefs.currentTime;
        var totEl = panelRefs.totalTime;
        var statusEl = panelRefs.status;
        var etaEl = panelRefs.eta;
        var etaSpan = panelRefs.etaSpan;
        if (fill) {
            fill.style.width = pct + '%';
            fill.className = (pct >= 100) ? 'done' : '';
        }
        if (curEl) curEl.textContent = formatDuration(currentSec);
        if (totEl) totEl.textContent = formatDuration(durationSec);
        if (pct >= 100) {
            setStatus(statusEl, 'stopped', '✅ 已完成');
        } else if (paused) {
            setStatus(statusEl, 'paused', '▶ 继续播放');
        } else {
            setStatus(statusEl, 'playing', '▶ 播放中');
        }
        if (etaEl && etaSpan) {
            if (pct >= 100) {
                etaEl.className = 'done';
                etaSpan.textContent = '已完成';
            } else if (durationSec > 0 && currentSec > 0 && !paused) {
                var remainingSec = Math.max(0, durationSec - currentSec);
                var etaDate = new Date(Date.now() + remainingSec * 1000);
                var etaH = etaDate.getHours();
                var etaM = String(etaDate.getMinutes()).padStart(2, '0');
                etaSpan.textContent = etaH + ':' + etaM;
                etaEl.className = '';
            } else if (paused) {
                etaSpan.textContent = '已暂停';
                etaEl.className = '';
            } else {
                etaSpan.textContent = '--:--';
                etaEl.className = '';
            }
        }
    }

    function updateChapterInfo(completed, total, title) {
        dash.lastChapterCompleted = completed;
        dash.chapterCompleted = completed;
        dash.chapterTotal = total;
        dash.chapterTitle = title;
    }


    // =============== 章节列表解析 ===============
    function parseChapterList() {
        var result = [];

        // 方法1：找所有文本以"数字."开头且较短的 div 作为候选
        var candidates = [];
        var divs = document.querySelectorAll('div, li');
        for (var i = 0; i < divs.length; i++) {
            var el = divs[i];
            var txt = el.textContent.trim().replace(/\s+/g, ' ');
            // 文本以数字开头，总长度适中，子元素不多（避免大容器）
            if (/^\d+[.\s、][^\n]{2,80}$/.test(txt) && el.children.length <= 4) {
                candidates.push(el);
            }
        }

        // 方法2：找这些候选元素的共同父容器
        var bestParent = null;
        if (candidates.length >= 2) {
            var parentMap = {};
            var bestCount = 0;
            for (var i = 0; i < candidates.length; i++) {
                var p = candidates[i].parentElement;
                while (p && p !== document.body) {
                    var key = p.tagName + '|' + (p.className || '');
                    if (!parentMap[key]) parentMap[key] = { el: p, count: 0, hasStatus: false };
                    parentMap[key].count++;
                    var pt = p.textContent;
                    if (pt.indexOf('正在学') !== -1 || pt.indexOf('已完成') !== -1 || pt.indexOf('已学') !== -1) {
                        parentMap[key].hasStatus = true;
                    }
                    p = p.parentElement;
                }
            }
            // 优先选包含状态文字且候选最多的容器
            for (var key in parentMap) {
                var info = parentMap[key];
                if (info.hasStatus && info.count >= 2) {
                    bestParent = info.el;
                    break;
                }
            }
            if (!bestParent) {
                for (var key2 in parentMap) {
                    var info2 = parentMap[key2];
                    if (info2.count > bestCount && info2.count >= 2) {
                        bestCount = info2.count;
                        bestParent = info2.el;
                    }
                }
            }
        }

        // 方法3：如果上面没找到，尝试从"章节"标题容器找
        var targetContainer = bestParent;
        if (!targetContainer) {
            var allEls = document.querySelectorAll('div, span, h1, h2, h3, h4, section');
            for (var h = 0; h < allEls.length; h++) {
                var t = allEls[h].textContent.trim();
                if (t === '章节' || t === '章节目录' || t === '目录') {
                    targetContainer = allEls[h].parentElement;
                    if (targetContainer) break;
                }
            }
        }

        if (!targetContainer) return result;

        // 从目标容器中读取列表项
        var items = targetContainer.querySelectorAll('li, div');
        for (var j = 0; j < items.length; j++) {
            var item = items[j];
            if (item.tagName === 'SCRIPT' || item.tagName === 'STYLE') continue;
            var text = item.textContent.trim().replace(/\s+/g, ' ');
            var m = text.match(/^(\d+)[.\s、]+(.+?)$/);
            if (!m) continue;

            var num = m[1];
            var title = m[2].replace(/(已完成|已学|正在学|正在播放|未开始|未学习|待学习)/g, '').trim();
            if (!title || title.length > 100) continue;

            // 避免读取到页面大标题（通常不含编号）
            if (/企业会计准则专题|培训|课程|东财|主讲教师/.test(title)) continue;

            var cls = item.className || '';
            var isCompleted = text.indexOf('已完成') !== -1 ||
                              text.indexOf('已学') !== -1 ||
                              /completed|done|finish|checked/i.test(cls);
            var isCurrent = text.indexOf('正在学') !== -1 ||
                            text.indexOf('正在播放') !== -1 ||
                            /active|current|playing|selected/i.test(cls) ||
                            item.getAttribute('aria-selected') === 'true' ||
                            !!item.querySelector('svg path[fill="#f5222d"], svg path[fill="#ef4444"], svg path[fill="#ff4d4f"], svg path[fill="#faad14"]');

            result.push({
                index: parseInt(num),
                title: title,
                completed: isCompleted,
                current: isCurrent,
                element: item
            });
        }

        // 去重并按序号排序
        var seen = {};
        var unique = [];
        for (var k = 0; k < result.length; k++) {
            var key = result[k].index + ':' + result[k].title;
            if (!seen[key]) {
                seen[key] = true;
                unique.push(result[k]);
            }
        }
        return unique.sort(function(a, b) { return a.index - b.index; });
    }

    // =============== 页面类型识别 ===============
    function detectPageType() {
        var hasLearnBtn = false;
        var btns = document.querySelectorAll('button');
        for (var i = 0; i < btns.length; i++) {
            if (btns[i].textContent.trim() === '学习') { hasLearnBtn = true; break; }
        }
        var hasVideo = !!document.querySelector('video');
        if (hasLearnBtn) return 'list';
        if (hasVideo) return 'play';
        return 'unknown';
    }
    function findChapterTitle() {
        var sels = ['h1', 'h2', 'h3', '.title', '[class*="title"]', '[class*="chapter-name"]', '[class*="video-title"]'];
        for (var i = 0; i < sels.length; i++) {
            var el = document.querySelector(sels[i]);
            if (el && el.textContent.trim().length > 2 && el.textContent.trim().length < 200) {
                return el.textContent.trim();
            }
        }
        var items = document.querySelectorAll('.active, .current, [class*="active"], [class*="current"], [class*="playing"]');
        for (var j = 0; j < items.length; j++) {
            var t = items[j].textContent.trim();
            if (t.length > 2 && t.length < 200 && !/已完成|已学/.test(t)) return t;
        }
        return '';
    }

    function tryCountTotalFromDOM() {
        var candidates = document.querySelectorAll(
            'ul, ol, ' +
            '[class*="chapter"], [class*="section"], [class*="lesson"], ' +
            '[class*="course"], [class*="list"], [class*="catalog"], ' +
            '[class*="item"], [role="list"], [role="group"]'
        );
        var bestCount = 0;

        for (var i = 0; i < candidates.length; i++) {
            var d = candidates[i];
            var txt = d.textContent;
            var m = txt.match(/(\d+)\s*\/\s*(\d+)/);
            if (m && parseInt(m[2]) > parseInt(m[1])) {
                var children = d.querySelectorAll('li, [class*="item"], [class*="chapter"]');
                if (children.length >= 2 && children.length > bestCount) {
                    bestCount = children.length;
                }
            }
        }

        if (bestCount < 2) {
            for (var j = 0; j < candidates.length; j++) {
                var div = candidates[j];
                var items = div.querySelectorAll('li, [class*="item"], [class*="chapter"]');
                if (items.length >= 2) {
                    var doneCount = 0;
                    for (var k = 0; k < items.length; k++) {
                        var itemText = items[k].textContent;
                        if (itemText.indexOf('已完成') !== -1 || itemText.indexOf('已学') !== -1 ||
                            /completed|done|finish/i.test(items[k].className || '')) {
                            doneCount++;
                        }
                    }
                    if (doneCount > 0 && items.length > bestCount) {
                        bestCount = items.length;
                    }
                }
            }
        }
        return bestCount >= 2 ? bestCount : 0;
    }

    // =============== 列表页功能 ===============
    function findCourseCards() {
        var cards = [];
        var btns = document.querySelectorAll('button');
        for (var i = 0; i < btns.length; i++) {
            var btn = btns[i];
            if (btn.textContent.trim() === '学习') {
                var card = btn.closest('div[class*="course"], div[class*="item"], li, div[class*="card"]') || btn.parentElement;
                cards.push({ button: btn, card: card });
            }
        }
        return cards;
    }
    function extractCourseInfo(cardData) {
        var card = cardData.card;
        var progress = 0, title = '';
        var pEl = card.querySelector('[class*="progress"] span, [class*="schedule"] span, [class*="percent"]');
        if (pEl) { var m = pEl.textContent.match(/(\d+(?:\.\d+)?)%/); if (m) progress = parseFloat(m[1]); }
        if (progress === 0) {
            var spans = card.querySelectorAll('span');
            for (var si = 0; si < spans.length; si++) {
                if (/^\d+(?:\.\d+)?%$/.test(spans[si].textContent.trim())) {
                    progress = parseFloat(spans[si].textContent.trim());
                    break;
                }
            }
        }
        if (progress === 0) {
            var el = card.querySelector('[data-progress], [data-schedule]');
            if (el) { var v = el.getAttribute('data-progress') || el.getAttribute('data-schedule'); if (v) progress = parseFloat(v); }
        }
        if (progress === 0) {
            var m2 = card.textContent.match(/(\d+(?:\.\d+)?)%/); if (m2) progress = parseFloat(m2[1]);
        }
        var h3 = card.querySelector('h3, h2, .title, [class*="title"]');
        if (h3) title = h3.textContent.trim();
        if (!title) {
            var divs = card.querySelectorAll('div');
            for (var di = 0; di < divs.length; di++) {
                var t = divs[di].textContent.trim();
                if (t.length > 5 && t.length < 150 && t.indexOf('%') === -1) { title = t; break; }
            }
        }
        if (!title) title = card.textContent.substring(0, 60).trim();
        return { button: cardData.button, card: card, progress: progress, title: title };
    }
    function scanAndEnterCourse() {
        if (!enabled) return;
        var cards = findCourseCards();
        if (cards.length === 0) { allCompletedCount = 0; return; }
        var courses = cards.map(extractCourseInfo);
        var allCompleted = true;
        for (var i = 0; i < courses.length; i++) {
            if (courses[i].progress < CONFIG.completedThreshold) { allCompleted = false; break; }
        }
        if (allCompleted) {
            allCompletedCount++;
            if (allCompletedCount >= CONFIG.allCompletedStopCount) {
                dashLog('✅', '所有课程已完成，停止巡检');
                enabled = false;
                setStatus(panelRefs.status, 'stopped', '✅ 全部完成');
                if (timers.scan) { clearInterval(timers.scan); timers.scan = null; }
            }
            return;
        }
        allCompletedCount = 0;
        for (var j = 0; j < courses.length; j++) {
            if (courses[j].progress < CONFIG.completedThreshold) {
                dashLog('🎯', '即将播放: ' + courses[j].title + '.mp4');
                courses[j].button.click();
                return;
            }
        }
    }

    // =============== 章节完成检测 ===============
    function checkChapterCompletion() {
        if (!enabled) return;
        var completed = 0, total = 0;
        var targetList = null;
        var lists = document.querySelectorAll('ul, ol, div[class*="chapter-list"], div[class*="section-list"]');
        for (var i = 0; i < lists.length; i++) {
            var items = lists[i].querySelectorAll('li, div[class*="chapter-item"], div[class*="section-item"]');
            if (items.length >= 2) {
                var hasStatus = false;
                for (var t = 0; t < items.length; t++) {
                    if (items[t].querySelector('svg, i, [class*="icon"]') ||
                        items[t].textContent.indexOf('已完成') !== -1 ||
                        items[t].textContent.indexOf('已学') !== -1) { hasStatus = true; break; }
                }
                if (hasStatus) { targetList = lists[i]; break; }
            }
        }
        if (!targetList) {
            var divs = document.querySelectorAll('div');
            for (var k = 0; k < divs.length; k++) {
                if (divs[k].textContent.indexOf('已完成') !== -1 && divs[k].children.length > 1) {
                    targetList = divs[k]; break;
                }
            }
        }
        if (targetList) {
            var items = targetList.querySelectorAll('li, div[class*="chapter-item"], div[class*="section-item"], div[class*="item"]');
            if (items.length >= 1) {
                total = items.length;
                for (var ci = 0; ci < items.length; ci++) {
                    var item = items[ci];
                    var greenSvg = item.querySelector('svg path[fill="#52c41a"], svg path[fill="#27ae60"], svg path[fill="#10b981"]');
                    var hasText = item.textContent.indexOf('已完成') !== -1 || item.textContent.indexOf('已学') !== -1;
                    var cls = item.className || '';
                    var hasCls = /completed|done|finish|checked/i.test(cls);
                    var aria = item.getAttribute('aria-checked') || item.getAttribute('data-status') || item.getAttribute('aria-selected');
                    var isAttr = (aria === 'true' || aria === 'completed' || aria === 'finished' || aria === 'selected');
                    var ds = item.getAttribute('data-status');
                    var isDs = ds && ['finished','completed','done'].indexOf(ds.toLowerCase()) !== -1;
                    if (greenSvg || hasText || hasCls || isAttr || isDs) completed++;
                }
            }
        }
        if (total === 0) {
            total = tryCountTotalFromDOM();
        }
        if (total === 0) {
            completed = dash.endedCount;
            total = 0;
        } else {
            if (dash.endedCount > completed) {
                completed = dash.endedCount;
                if (completed > total) completed = total;
            }
        }
        var chTitle = findChapterTitle();
        updateChapterInfo(completed, total, chTitle);
        if (total > 0 && completed >= total) {
            dashLog('📖', '所有章节已完成，等待评价弹窗...');
            if (timers.check) { clearInterval(timers.check); timers.check = null; }
        }
    }

    // =============== 弹窗检测 ===============
    function closePopupAndReturn(btn) {
        btn.click();
        dashLog('🔙', '2秒后返回列表页...');
        setTimeout(function () { goBack(); }, CONFIG.returnDelay);
        if (timers.popup) { clearInterval(timers.popup); timers.popup = null; }
        popupRetryCount = 0;
    }

    function checkAndHandlePopup() {
        if (!enabled) return;
        var modal = null;
        var sels = ['.el-dialog', '.ant-modal', '.modal', '.dialog', 'div[role="dialog"]', 'div[class*="popup"]', 'div[class*="modal"]'];
        for (var s = 0; s < sels.length; s++) {
            var el = document.querySelector(sels[s]);
            if (el && (el.textContent.indexOf('评价') !== -1 || el.textContent.indexOf('评分') !== -1)) { modal = el; break; }
        }
        if (!modal) {
            var walker = document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_TEXT,
                {
                    acceptNode: function (node) {
                        var t = node.textContent;
                        if (t.indexOf('请您对该课程进行评价') !== -1 || t.indexOf('课程评价') !== -1) {
                            return NodeFilter.FILTER_ACCEPT;
                        }
                        return NodeFilter.FILTER_SKIP;
                    }
                }
            );
            var textNode = walker.nextNode();
            if (textNode) {
                var parent = textNode.parentNode;
                while (parent && parent !== document.body) {
                    if (parent.tagName === 'DIV' && parent.children.length > 0) {
                        modal = parent;
                        break;
                    }
                    parent = parent.parentNode;
                }
            }
        }
        if (!modal) { popupRetryCount = 0; return; }
        var btns = modal.querySelectorAll('button');
        for (var b = 0; b < btns.length; b++) {
            var text = btns[b].textContent.trim();
            if (/^(好的|确定|确认|OK|是|我知道了)$/i.test(text)) {
                dashLog('💬', '自动关闭评价弹窗 (点击"' + text + '")');
                closePopupAndReturn(btns[b]);
                return;
            }
        }
        if (btns.length > 0) {
            dashLog('💬', '尝试点击弹窗按钮...');
            closePopupAndReturn(btns[0]);
            return;
        }
        popupRetryCount++;
        if (popupRetryCount >= CONFIG.popupMaxRetry) {
            dashLog('⚠️', '弹窗按钮不可用，强制返回');
            goBack();
            if (timers.popup) { clearInterval(timers.popup); timers.popup = null; }
            popupRetryCount = 0;
        }
    }

    function goBack() {
        var sels = ['a[href*="plan"]', 'a[href*="return"]', 'a[class*="back"]', 'button[class*="back"]', '[class*="back-btn"]'];
        for (var i = 0; i < sels.length; i++) {
            var el = document.querySelector(sels[i]);
            if (el) { el.click(); return; }
        }
        var links = document.querySelectorAll('nav a, header a, .breadcrumb a');
        for (var j = 0; j < links.length; j++) {
            if (/返回|计划|列表/i.test(links[j].textContent)) { links[j].click(); return; }
        }

        var currentPath = location.pathname;
        var pathSegments = currentPath.split('/').filter(Boolean);
        if (pathSegments.length > 1) {
            pathSegments.pop();
            var listUrl = location.origin + '/' + pathSegments.join('/');
            dashLog('🔗', '尝试导航到列表页: ' + listUrl);
            location.href = listUrl;
            return;
        }

        if (window.history.length > 1) {
            dashLog('🔙', '使用浏览器历史返回');
            window.history.back();
        }
    }

    // =============== 视频控制（模拟用户手势版） ===============
    // 经验教训：
    // 1. 站点播放器会识别 video.play() 为自动播放并反暂停
    // 2. 脚本点击真实播放按钮也无法建立用户手势授权
    // 3. 唯一可行的办法是在 video 元素上模拟完整鼠标/触摸/pointer 事件序列
    // 4. 为避免死循环，pause 事件只做记录，不再主动恢复
    // 因此新策略是：
    // 1. 进入播放页时，如果视频暂停，模拟一次完整手势后调用 video.play()
    // 2. pause 事件只更新面板，不恢复（避免触发站点反制）
    // 3. 后台时不干预
    // 4. 回到前台时，如果暂停，再模拟一次手势 + play()
    // 5. 心跳只更新面板
    // 6. 静音在第一次 play 事件时设置一次
    function setupVideoControl() {
        var video = document.querySelector('video');
        console.log('[DC助手] setupVideoControl 视频元素:', video);
        if (!video) { dashLog('⚠️', '未找到视频元素'); return null; }

        var destroyed      = false;
        var userInteracted = false;
        var playStartTime  = null;
        var totalPlayTime  = 0;
        var lastDashUpdate = 0;
        var hasMuted       = false;
        var hasPausedOnce  = false; // 暂停后再次播放时，日志显示“继续播放”
        var lastProgressLogTime = 0; // 上次输出进度日志的时间

        var control = {
            video: video,
            eventListeners: [],
            heartbeatTimer: null,
            visibilityHandler: null,

            // 模拟真实用户手势点击视频区域
            // 只在视频确实暂停时才触发，避免 toggle 导致播放中的视频被暂停
            simulateUserGesture: function () {
                if (!video.paused || video.ended) return;
                var rect = video.getBoundingClientRect();
                var cx = rect.left + rect.width / 2;
                var cy = rect.top + rect.height / 2;

                var mouseEvents = ['mouseenter', 'mouseover', 'mousemove', 'mousedown', 'mouseup', 'click'];
                for (var i = 0; i < mouseEvents.length; i++) {
                    video.dispatchEvent(new MouseEvent(mouseEvents[i], {
                        bubbles: true, cancelable: true, view: window,
                        clientX: cx, clientY: cy, screenX: cx, screenY: cy,
                        button: 0, buttons: 1, relatedTarget: video
                    }));
                }

                if (typeof TouchEvent !== 'undefined' && typeof Touch !== 'undefined') {
                    try {
                        var touch = new Touch({
                            identifier: Date.now(), target: video,
                            clientX: cx, clientY: cy, pageX: cx, pageY: cy,
                            screenX: cx, screenY: cy,
                            radiusX: 1, radiusY: 1, rotationAngle: 0, force: 1
                        });
                        video.dispatchEvent(new TouchEvent('touchstart', {
                            bubbles: true, cancelable: true, view: window,
                            touches: [touch], targetTouches: [touch], changedTouches: [touch]
                        }));
                        video.dispatchEvent(new TouchEvent('touchend', {
                            bubbles: true, cancelable: true, view: window,
                            touches: [], targetTouches: [], changedTouches: [touch]
                        }));
                    } catch (e) {}
                }

                // 分发 pointer 事件（现代浏览器更认可）
                if (typeof PointerEvent !== 'undefined') {
                    var pointerEvents = ['pointerenter', 'pointerover', 'pointerdown', 'pointerup', 'pointerleave'];
                    for (var p = 0; p < pointerEvents.length; p++) {
                        video.dispatchEvent(new PointerEvent(pointerEvents[p], {
                            bubbles: true, cancelable: true, view: window,
                            clientX: cx, clientY: cy, screenX: cx, screenY: cy,
                            pointerId: 1, pointerType: 'mouse', isPrimary: true,
                            button: 0, buttons: 1
                        }));
                    }
                }
            },

            init: function () {
                console.log('[DC助手] videoControl init 执行');
                dash.chapterCompleted = 0;
                dash.chapterTotal = 0;

                var dur = video.duration || 0;
                var cur = video.currentTime || 0;
                updateProgress(cur, dur, video.paused);

                var chTitle = findChapterTitle();
                if (chTitle) dash.chapterTitle = chTitle;
                updateChapterInfo(dash.endedCount, 0, dash.chapterTitle);



                // play 事件：同步进度、设置静音、记录日志
                var playHandler = function () {
                    console.log('[DC助手] play 事件触发');
                    if (destroyed) return;
                    playStartTime = Date.now();
                    lastDashUpdate = 0;
                    if (!hasMuted) {
                        video.muted = true;
                        hasMuted = true;
                    }
                    if (hasPausedOnce) {
                        dashLog('▶️', '继续播放');
                        hasPausedOnce = false;
                    }
                    userInteracted = true;
                    updateProgress(video.currentTime, video.duration, false);
                };

                // pause 事件：记录状态，不主动恢复
                var pauseHandler = function () {
                    if (destroyed || !enabled) return;
                    if (video.ended) return;
                    if (playStartTime) { totalPlayTime += (Date.now() - playStartTime) / 1000; playStartTime = null; }
                    dashLog('⏸', '视频暂停 (' + formatDuration(video.currentTime) + ' / ' + formatDuration(video.duration) + ')');
                    hasPausedOnce = true;
                    updateProgress(video.currentTime, video.duration, true);
                };

                // ended 事件：章节完成
                var endedHandler = function () {
                    if (destroyed) return;
                    if (playStartTime) { totalPlayTime += (Date.now() - playStartTime) / 1000; playStartTime = null; }
                    updateProgress(video.duration, video.duration, false);
                    dash.endedCount++;

                    var chapterList = parseChapterList();
                    var currentChapter = null;
                    var nextChapter = null;
                    for (var ci = 0; ci < chapterList.length; ci++) {
                        if (chapterList[ci].current) {
                            currentChapter = chapterList[ci];
                            for (var ni = ci + 1; ni < chapterList.length; ni++) {
                                if (!chapterList[ni].completed) {
                                    nextChapter = chapterList[ni];
                                    break;
                                }
                            }
                            break;
                        }
                    }
                    if (!currentChapter && chapterList.length > 0) {
                        for (var li = chapterList.length - 1; li >= 0; li--) {
                            if (chapterList[li].completed) {
                                currentChapter = chapterList[li];
                                if (li + 1 < chapterList.length) {
                                    nextChapter = chapterList[li + 1];
                                }
                                break;
                            }
                        }
                    }

                    var currentName = currentChapter ? (currentChapter.index + '。' + currentChapter.title) : (dash.chapterTitle && dash.chapterTitle.indexOf('。') !== -1 ? dash.chapterTitle : '当前章节');
                    dashLog('🏁', '播放完成：' + (currentName || '当前章节'));
                    if (nextChapter) {
                        dashLog('🎯', '即将播放：' + nextChapter.index + '。' + nextChapter.title);
                    } else if (dash.chapterTotal > 0 && dash.endedCount >= dash.chapterTotal) {
                        dashLog('✅', '所有章节已播放完成');
                    }

                    totalPlayTime = 0;
                    if (dash.chapterTotal === 0) {
                        updateChapterInfo(dash.endedCount, 0, dash.chapterTitle);
                    }
                    setTimeout(function () { checkChapterCompletion(); }, CONFIG.chapterCheckDelay);
                };

                // timeupdate 事件：更新面板，每 30 秒输出一次进度日志
                var timeupdateHandler = function () {
                    if (destroyed) return;
                    var now = Date.now();
                    if (now - lastDashUpdate > CONFIG.dashUpdateInterval) {
                        lastDashUpdate = now;
                        updateProgress(video.currentTime, video.duration, video.paused);
                    }
                    // 不再输出播放进度日志，避免日志刷屏
                    // if (now - lastProgressLogTime > 30000) {
                    //     lastProgressLogTime = now;
                    //     if (!video.paused) {
                    //         var pct = video.duration > 0 ? Math.round(video.currentTime / video.duration * 100) : 0;
                    //         dashLog('📊', '播放进度 ' + pct + '% (' + formatDuration(video.currentTime) + ' / ' + formatDuration(video.duration) + ')');
                    //     }
                    // }
                };

                video.addEventListener('play',       playHandler);
                video.addEventListener('pause',      pauseHandler);
                video.addEventListener('ended',      endedHandler);
                video.addEventListener('timeupdate', timeupdateHandler);
                control.eventListeners.push({ event: 'play', handler: playHandler });
                control.eventListeners.push({ event: 'pause', handler: pauseHandler });
                control.eventListeners.push({ event: 'ended', handler: endedHandler });
                control.eventListeners.push({ event: 'timeupdate', handler: timeupdateHandler });

                var clickHandler = function () { if (!userInteracted) userInteracted = true; };
                document.addEventListener('click', clickHandler, true);
                control.eventListeners.push({ event: 'click', handler: clickHandler, capture: true, target: document });

                // 可见性变化：记录前后台切换，回到前台时如果暂停则尝试恢复
                control.visibilityHandler = function () {
                    if (destroyed || !enabled) return;
                    if (document.hidden) {
                        // dashLog('🌙', '切换到后台，停止干预');  // 不显示后台切换日志
                    } else {
                        // dashLog('☀️', '回到前台');  // 不显示回到前台日志
                        setTimeout(function () {
                            if (!destroyed && enabled && !video.ended && video.paused) {
                                control.simulateUserGesture();
                                video.play().catch(function () {});
                            }
                        }, CONFIG.visibilityResumeDelay);
                    }
                };
                document.addEventListener('visibilitychange', control.visibilityHandler);

                // 心跳：只更新面板，不干预视频
                control.heartbeatTimer = setInterval(function () {
                    if (destroyed || !enabled) return;
                    updateProgress(video.currentTime, video.duration, video.paused);
                }, CONFIG.heartbeatInterval);

                // 初始启动：如果视频暂停，模拟一次用户手势并尝试播放
                setTimeout(function () {
                    if (!destroyed && enabled && video.paused && !video.ended) {
                        // dashLog('🚀', '尝试自动启动播放');  // 不显示自动启动日志
                        control.simulateUserGesture();
                        video.play().then(function () {
                            // 自动开始播放不再写入日志，避免事件日志刷屏
                        }).catch(function () {
                            dashLog('⚠️', '自动启动播放失败，请手动点击播放按钮');
                        });
                    } else if (!destroyed && enabled && !video.paused && !video.ended) {
                        // 已在播放状态不再写入日志
                    }
                }, CONFIG.initDelay);

                // 检测视频是否已在播放状态（主动输出日志）
                setTimeout(function () {
                    if (destroyed) return;
                    if (!video.paused && !userInteracted) {
                        userInteracted = true;
                        playStartTime = Date.now();
                        lastDashUpdate = 0;
                        if (!hasMuted) {
                            video.muted = true;
                            hasMuted = true;
                        }
                        updateProgress(video.currentTime, video.duration, false);
                    }
                }, CONFIG.playStateCheckDelay);

                setStatus(panelRefs.status, 'playing', '▶ 播放中');
            },

            destroy: function () {
                destroyed = true;
                if (playStartTime && !video.ended) { totalPlayTime += (Date.now() - playStartTime) / 1000; playStartTime = null; }
                if (this.heartbeatTimer)   { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
                if (this.visibilityHandler) { document.removeEventListener('visibilitychange', this.visibilityHandler); this.visibilityHandler = null; }
                for (var i = 0; i < this.eventListeners.length; i++) {
                    var item = this.eventListeners[i];
                    (item.target || video).removeEventListener(item.event, item.handler, item.capture || false);
                }
                this.eventListeners = [];
                dash.chapterCompleted = 0;
                dash.chapterTotal = 0;
            }
        };

        control.init();
        return control;
    }

    // =============== 页面切换调度 ===============
    function onPageTypeChange(newType, force) {
        console.log('[DC助手] 页面类型变化:', newType, 'force:', force, 'current:', currentPageType);
        if (!force && newType === currentPageType && isInitialized) return;

        clearAllTimers();
        currentPageType = newType;
        popupRetryCount = 0;

        if (!enabled) return;

        if (newType === 'list') {
            dashLog('📋', '进入列表页，启动课程扫描');
            setStatus(panelRefs.status, 'stopped', '📋 列表页');
            updateProgress(0, 0, true);
            setTimeout(function () {
                if (currentPageType === 'list' && enabled) {
                    scanAndEnterCourse();
                    timers.scan = setInterval(scanAndEnterCourse, CONFIG.scanInterval);
                }
            }, CONFIG.startDelay);
        } else if (newType === 'play') {
            var video = document.querySelector('video');
            if (video) {
                lastVideoSrc = video.src || video.getAttribute('src') || '';
            }
            dashLog('🎬', '进入播放页');
            videoControlInstance = setupVideoControl();
            timers.check = setInterval(checkChapterCompletion, CONFIG.checkInterval);
            timers.popup = setInterval(checkAndHandlePopup, CONFIG.popupCheckInterval);
            if (timers.videoMonitor) clearInterval(timers.videoMonitor);
            timers.videoMonitor = setInterval(function () {
                if (!enabled || currentPageType !== 'play') return;
                var v = document.querySelector('video');
                if (!v) return;
                var currentSrc = v.src || v.getAttribute('src') || '';
                // 只用 src 变化判断视频切换
                if (currentSrc && currentSrc !== lastVideoSrc) {
                    lastVideoSrc = currentSrc;
                    updateProgress(v.currentTime || 0, v.duration || 0, v.paused);
                    var now = Date.now();
                    if (now - lastReinitTime >= CONFIG.reinitGuardDelay) {
                        lastReinitTime = now;
                        if (videoControlInstance) {
                            videoControlInstance.destroy();
                            videoControlInstance = null;
                        }
                        videoControlInstance = setupVideoControl();
                    }
                }
            }, CONFIG.videoMonitorInterval);

            setTimeout(function () { checkChapterCompletion(); checkAndHandlePopup(); }, CONFIG.initDelay);
        }
    }

    // =============== 页面检测 ===============
    function startPageDetection() {
        var lastUrl = location.href;

        function checkPage() {
            var newUrl = location.href;
            if (newUrl !== lastUrl) {
                lastUrl = newUrl;
                onPageTypeChange(detectPageType());
            } else {
                var type = detectPageType();
                if (type !== currentPageType) {
                    onPageTypeChange(type);
                } else if (type === 'play') {
                    var currentVideo = document.querySelector('video');
                    if (currentVideo) {
                        if (videoControlInstance && videoControlInstance.video !== currentVideo) {
                            onPageTypeChange('play', true);
                        }
                    }
                }
            }
        }

        window.addEventListener('popstate',  checkPage);
        window.addEventListener('hashchange', checkPage);
        timers.pageDetect = setInterval(checkPage, CONFIG.pageDetectInterval);

        pageObserver = new MutationObserver(function (mutations) {
            var hasExternalChange = false;
            for (var i = 0; i < mutations.length; i++) {
                if (!panel || !panel.contains(mutations[i].target)) {
                    hasExternalChange = true;
                    break;
                }
            }
            if (!hasExternalChange) return;

            if (pageObserver._debounce) clearTimeout(pageObserver._debounce);
            pageObserver._debounce = setTimeout(function () {
                checkPage();
                pageObserver._debounce = null;
            }, CONFIG.observerDebounce);
        });
        pageObserver.observe(document.body, { childList: true, subtree: true, attributes: false });

        setTimeout(function () {
            onPageTypeChange(detectPageType());
            isInitialized = true;
        }, CONFIG.initDelay);
    }

    function clearAllTimers() {
        var keys = Object.keys(timers);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            if (timers[key]) { clearInterval(timers[key]); timers[key] = null; }
        }
        if (videoControlInstance) { videoControlInstance.destroy(); videoControlInstance = null; }
        if (pageObserver) { pageObserver.disconnect(); pageObserver = null; }
    }

    // =============== 菜单 ===============
    function registerMenuCommands() {
        GM_registerMenuCommand('🔍 扫描未完成课程', function () {
            if (currentPageType === 'list') scanAndEnterCourse();
            else dashLog('⚠️', '当前不在列表页');
        });
        GM_registerMenuCommand('🔙 返回列表页', function () { goBack(); });
        GM_registerMenuCommand('🔄 重新启用', function () {
            if (!enabled) {
                enabled = true; allCompletedCount = 0; popupRetryCount = 0;
                dashLog('🚀', '已重新启用自动扫描');
                onPageTypeChange(detectPageType());
            } else { dashLog('📌', '脚本已处于启用状态'); }
        });
        GM_registerMenuCommand('⏯️ 切换启用', function () {
            enabled = !enabled;
            if (!enabled) {
                clearAllTimers();
                setStatus(panelRefs.status, 'stopped', '⏸ 已禁用');
                dashLog('⚠️', '脚本已禁用');
            } else {
                allCompletedCount = 0; popupRetryCount = 0;
                dashLog('🚀', '脚本已启用');
                onPageTypeChange(detectPageType());
            }
        });
    }

    // =============== 初始化 ===============
    function init() {
        console.log('[DC助手] init 开始');
        createPanel();
        console.log('[DC助手] 面板创建完成', panelRefs);
        registerMenuCommands();
        startPageDetection();
        console.log('[DC助手] 页面检测已启动');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
