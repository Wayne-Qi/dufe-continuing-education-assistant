 ==UserScript==
 @name         东北财经大学继续教育在线学习
 @namespace    httptampermonkey.net
 @version      0.1.3
 @description  课程自动播放助手 - 全自动循环学习
 @author       Qi
 @match        trahljkj.edufe.cn
 @grant        GM_registerMenuCommand
 @grant        GM_addStyle
 @run-at       document-end
 @license MIT
 ==UserScript==

(function () {
    'use strict';

     =============== 配置 ===============
    var CONFIG = {
        checkInterval 3000,
        returnDelay 2000,
        startDelay 3000,
        completedThreshold 100,
        popupCheckInterval 2000,
        allCompletedStopCount 3,
        heartbeatInterval 3000,
        pageDetectInterval 1000,
        resumeRetryDelay 800,
        panelDefaultWidth 400,
        logMinHeight 100,
        logMaxHeightRatio 0.8,
        videoMonitorInterval 1000,
        scanInterval 5000,
         [优化] 魔法数字提取到 CONFIG
        logMaxRows 30,
        dashUpdateInterval 1500,
        chapterCheckDelay 500,
        reinitGuardDelay 500,
        initDelay 1500,
        playStateCheckDelay 300,
        visibilityResumeDelay 600,
        popupMaxRetry 10,
        observerDebounce 500,
    };

     =============== 状态 ===============
    var enabled            = true;
    var allCompletedCount  = 0;
    var currentPageType    = 'unknown';
    var popupRetryCount    = 0;
    var timers = { check null, scan null, popup null, heartbeat null, pageDetect null, videoMonitor null };
    var videoControlInstance = null;
    var panel              = null;
    var panelRefs          = {};   [优化] 缓存面板元素引用
    var isInitialized      = false;
    var pageObserver       = null;
    var lastVideoSrc       = '';
    var lastVideoDuration  = 0;
    var lastReinitTime     = 0;    [优化] 替代 isReinitializing 的节流时间戳

    var dash = {
        chapterCompleted 0,
        chapterTotal 0,
        chapterTitle '',
        lastChapterCompleted 0,
        endedCount 0,
        autoDetectChapters true,
    };

     =============== 工具函数 ===============
    function formatTime(date) {
        var h = String(date.getHours()).padStart(2, '0');
        var m = String(date.getMinutes()).padStart(2, '0');
        var s = String(date.getSeconds()).padStart(2, '0');
        return h + '' + m + '' + s;
    }

    function pad2(n) { return String(Math.floor(n)).padStart(2, '0'); }
    function formatDuration(totalSec) {
        if (totalSec = 0) return '000';
        var h = Math.floor(totalSec  3600);
        var m = Math.floor((totalSec % 3600)  60);
        var s = Math.floor(totalSec % 60);
        if (h  0) return h + '' + pad2(m) + '' + pad2(s);
        return m + '' + pad2(s);
    }

     =============== 面板创建 ===============
    var CSS = ''
    + '#dc-panel{positionfixed;top10px;left10px;z-index999999;'
    + 'width' + CONFIG.panelDefaultWidth + 'px;'
    + 'backgroundlinear-gradient(180deg,#fafbfc 0%,#f0f3f6 100%);'
    + 'border1px solid #c8d1da;border-radius14px;'
    + 'font-family-apple-system,BlinkMacSystemFont,Segoe UI,Microsoft YaHei,sans-serif;'
    + 'font-size13px;color#3c4757;box-shadow0 6px 24px rgba(60,71,87,0.12);'
    + 'user-selectnone;min-width400px;}n'
    + '#dc-panel {box-sizingborder-box;margin0;padding0;}n'
    + '#dc-header{cursormove;padding12px 16px;displayflex;justify-contentspace-between;align-itemscenter;'
    + 'border-bottom1px solid #c8d1da;'
    + 'backgroundlinear-gradient(135deg,#eef2f6 0%,#e2e8ee 100%);border-radius14px 14px 0 0;}n'
    + '#dc-title{font-size14px;font-weight600;color#2c3e50;}n'
    + '#dc-status{padding3px 12px;border-radius12px;font-size11px;font-weight600;letter-spacing0.5px;'
    + 'box-shadow0 1px 3px rgba(0,0,0,0.08);}n'
    + '#dc-status.playing{backgroundlinear-gradient(135deg,#d4f4dd,#b8e8c8);color#1a7f37;}n'
    + '#dc-status.paused{backgroundlinear-gradient(135deg,#fde0dc,#f8c9c2);color#cf222e;}n'
    + '#dc-status.stopped{backgroundlinear-gradient(135deg,#eceef1,#dfe3e8);color#656d76;}n'
    + '#dc-body{padding14px 16px 10px;}n'
    + '.dc-section{margin-bottom12px;}n'
    + '.dc-section-title{font-size11px;color#7a8794;text-transformuppercase;letter-spacing1px;margin-bottom8px;'
    + 'displayflex;align-itemscenter;gap6px;font-weight600;}n'
    + '.dc-section-titleafter{content;flex1;height1px;backgroundlinear-gradient(90deg,#c8d1da,transparent);}n'
    + '#dc-progress-bar{height10px;background#e2e8ee;border-radius5px;overflowhidden;margin-bottom10px;'
    + 'box-shadowinset 0 1px 2px rgba(0,0,0,0.06);}n'
    + '#dc-progress-fill{height100%;backgroundlinear-gradient(90deg,#2da44e,#5bb37a);border-radius5px;'
    + 'transitionwidth 0.5s ease;width0%;box-shadow0 1px 3px rgba(45,164,78,0.3);}n'
    + '#dc-progress-fill.done{backgroundlinear-gradient(90deg,#3b82f6,#60a5fa);box-shadow0 1px 3px rgba(59,130,246,0.3);}n'
    + '#dc-time-row{displayflex;justify-contentspace-between;align-itemscenter;margin-bottom6px;}n'
    + '#dc-current-time{font-size24px;font-weight700;color#2c3e50;font-variant-numerictabular-nums;}n'
    + '#dc-total-time{font-size24px;font-weight300;color#9aa5b1;font-variant-numerictabular-nums;}n'
    + '#dc-eta{font-size12px;color#7a8794;text-alignright;}n'
    + '#dc-eta span{color#7c5dcf;font-weight600;}n'
    + '#dc-eta.done span{color#1a7f37;}n'
    + '#dc-log{max-height500px;overflow-yauto;font-size13px;line-height1.7;color#3c4757;'
    + 'padding10px 12px;background#fcfdfe;border1px solid #d8dee5;border-radius10px;}n'
    + '#dc-log .log-row{displayflex;gap8px;align-itemsflex-start;padding3px 6px;border-radius6px;'
    + 'transitionbackground 0.15s;}n'
    + '#dc-log .log-rowhover{background#eef3f8;}n'
    + '#dc-log .log-time{color#9aa5b1;flex-shrink0;font-size12px;font-variant-numerictabular-nums;white-spacenowrap;}n'
    + '#dc-log .log-icon{flex-shrink0;}n'
    + '#dc-log .log-msg{color#3c4757;word-breakbreak-all;font-weight500;}n'
    + '#dc-log .log-msg.log-info{color#3c4757;}n'
    + '#dc-log .log-msg.log-warn{color#d97706;}n'
    + '#dc-log .log-msg.log-error{color#dc2626;}n'
    + '#dc-log .log-msg.log-success{color#16a34a;}n'
    + '#dc-log .log-count{color#9aa5b1;font-size11px;font-weight400;margin-left4px;}n'
    + '#dc-log-webkit-scrollbar{width6px;}n'
    + '#dc-log-webkit-scrollbar-thumb{background#c8d1da;border-radius3px;}n'
    + '#dc-log-webkit-scrollbar-thumbhover{background#a8b3bd;}n'
    + '#dc-log-webkit-scrollbar-track{backgroundtransparent;}n'
    + '#dc-resize-handle{positionabsolute;right0;top0;bottom0;width8px;cursorew-resize;z-index10;}n'
    + '#dc-resize-handlehover{backgroundrgba(59,130,246,0.1);}n'
    + '#dc-resize-vertical{height8px;cursorns-resize;backgroundtransparent;border-top1px solid #c8d1da;'
    + 'border-radius0 0 14px 14px;transitionbackground 0.15s;}n'
    + '#dc-resize-verticalhover{backgroundrgba(59,130,246,0.1);}n'
    + '#dc-toggle-btn{cursorpointer;padding3px 10px;border-radius8px;background#e2e8ee;'
    + 'font-size13px;color#656d76;line-height1.4;bordernone;transitionall 0.15s;}n'
    + '#dc-toggle-btnhover{background#c8d8f0;color#2563eb;}n';

    function createPanel() {
        if (document.getElementById('dc-panel')) return;
        GM_addStyle(CSS);
        var div = document.createElement('div');
        div.id = 'dc-panel';
        div.innerHTML =
            'div id=dc-resize-handlediv' +
            'div id=dc-header' +
            'span id=dc-title🎓 东北财经在线教育学习助手 by齐span' +
            'span id=dc-status class=stopped⏳ 就绪span' +
            'button id=dc-toggle-btn−button' +
            'div' +
            'div id=dc-body' +
            'div class=dc-section' +
            'div class=dc-section-title📊 视频播放进度div' +
            'div id=dc-progress-bardiv id=dc-progress-filldivdiv' +
            'div id=dc-time-row' +
            'span id=dc-current-time----span' +
            'span id=dc-total-time----span' +
            'div' +
            'div id=dc-eta⏰ 预计 span----span 结束div' +
            'div' +
            'div class=dc-section' +
            'div class=dc-section-title📋 事件日志div' +
            'div id=dc-logspan style=color#57606a;font-size14px;等待启动...spandiv' +
            'div' +
            'div' +
            'div id=dc-resize-verticaldiv';
        document.body.appendChild(div);

         宽度拖拽
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
                newW = Math.max(400, Math.min(newW, window.innerWidth - 20));
                div.style.width = newW + 'px';
            }
            function onResizeUp() {
                resizing = false;
                div.style.transition = '';
                document.body.style.cursor = '';
                document.removeEventListener('mousemove', onResizeMove);
                document.removeEventListener('mouseup', onResizeUp);
            }
            document.addEventListener('mousemove', onResizeMove);
            document.addEventListener('mouseup', onResizeUp);
        });

         纵向拖拽
        var verticalHandle = div.querySelector('#dc-resize-vertical');
        var logEl = div.querySelector('#dc-log');
        var isVerticalResizing = false;
        var resizeStartY = 0;
        var resizeStartHeight = 0;
        verticalHandle.addEventListener('mousedown', function (e) {
            e.preventDefault();
            e.stopPropagation();
            isVerticalResizing = true;
            resizeStartY = e.clientY;
            var currentMaxH = parseInt(window.getComputedStyle(logEl).maxHeight, 10);
            if (isNaN(currentMaxH)  currentMaxH = 0) currentMaxH = 500;
            resizeStartHeight = currentMaxH;
            document.body.style.cursor = 'ns-resize';
            function onResizeMove(ev) {
                if (!isVerticalResizing) return;
                var deltaY = ev.clientY - resizeStartY;
                var newHeight = resizeStartHeight + deltaY;
                var minH = CONFIG.logMinHeight;
                var maxH = Math.floor(window.innerHeight  CONFIG.logMaxHeightRatio);
                newHeight = Math.max(minH, Math.min(maxH, newHeight));
                logEl.style.maxHeight = newHeight + 'px';
            }
            function onResizeUp() {
                isVerticalResizing = false;
                document.body.style.cursor = '';
                document.removeEventListener('mousemove', onResizeMove);
                document.removeEventListener('mouseup', onResizeUp);
            }
            document.addEventListener('mousemove', onResizeMove);
            document.addEventListener('mouseup', onResizeUp);
        });

         拖动标题
        var header = div.querySelector('#dc-header');
        var toggleBtn = div.querySelector('#dc-toggle-btn');
        var body = div.querySelector('#dc-body');
        var isDragging = false, dragX = 0, dragY = 0;
        toggleBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            var hide = body.style.display !== 'none';
            body.style.display = hide  'none'  'block';
            toggleBtn.textContent = hide  '□'  '−';
        });
        header.addEventListener('mousedown', function (e) {
            if (e.target === toggleBtn  e.target === resizeHandle  e.target === verticalHandle) return;
            isDragging = true;
            var rect = div.getBoundingClientRect();
            dragX = e.clientX - rect.left;
            dragY = e.clientY - rect.top;
            div.style.opacity = '0.85';
            function onMove(ev) {
                if (!isDragging) return;
                var x = ev.clientX - dragX;
                var y = ev.clientY - dragY;
                div.style.left = Math.max(0, Math.min(x, window.innerWidth - div.offsetWidth)) + 'px';
                div.style.top = Math.max(0, Math.min(y, window.innerHeight - 30)) + 'px';
            }
            function onUp() {
                isDragging = false;
                div.style.opacity = '1';
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
        panel = div;

         [优化] 缓存面板元素引用，避免后续重复 querySelector
        panelRefs.panel        = div;
        panelRefs.status       = div.querySelector('#dc-status');
        panelRefs.progressFill = div.querySelector('#dc-progress-fill');
        panelRefs.currentTime  = div.querySelector('#dc-current-time');
        panelRefs.totalTime    = div.querySelector('#dc-total-time');
        panelRefs.eta          = div.querySelector('#dc-eta');
        panelRefs.etaSpan      = div.querySelector('#dc-eta span');
        panelRefs.log          = div.querySelector('#dc-log');
    }

     =============== 仪表盘更新函数 ===============
    function setStatus(el, cls, text) {
        if (!el) return;
        el.className = cls;
        el.textContent = text;
    }

     [优化] 查询一次批量删除，替代循环内重复查询
    function trimLog(logEl) {
        if (!logEl) return;
        var rows = logEl.querySelectorAll('.log-row');
        if (rows.length = CONFIG.logMaxRows) return;
        var removeCount = rows.length - CONFIG.logMaxRows;
        for (var i = 0; i  removeCount; i++) {
            if (rows[i].parentNode) rows[i].parentNode.removeChild(rows[i]);
        }
    }

     日志级别映射：根据 icon 自动推断级别
    var LOG_LEVELS = {
        '⚠️' 'warn', '❌' 'error',
        '✅' 'success', '🏁' 'success', '🚀' 'success',
        '▶️' 'info', '⏸' 'info', '🎬' 'info', '📋' 'info',
        '📖' 'info', '💬' 'info', '🔙' 'info', '🎯' 'info',
        '🔗' 'info', '📌' 'info', '🔇' 'info'
    };
    var lastLogMsg = '';
    var lastLogCount = 0;

    function dashLog(icon, msg) {
        var logEl = panelRefs.log;
        if (!logEl) return;
        var time = formatTime(new Date());

         console 镜像输出
        var level = LOG_LEVELS[icon]  'info';
        var consoleMsg = '[' + time + '] ' + icon + ' ' + msg;
        if (level === 'warn') console.warn(consoleMsg);
        else if (level === 'error') console.error(consoleMsg);
        else console.log(consoleMsg);

         去重：连续相同消息只更新计数
        if (msg === lastLogMsg) {
            lastLogCount++;
            var lastRow = logEl.lastElementChild;
            if (lastRow) {
                var countSpan = lastRow.querySelector('.log-count');
                if (!countSpan) {
                    countSpan = document.createElement('span');
                    countSpan.className = 'log-count';
                    var msgEl = lastRow.querySelector('.log-msg');
                    if (msgEl) msgEl.appendChild(countSpan);
                }
                countSpan.textContent = ' (x' + lastLogCount + ')';
                 更新时间
                var timeEl = lastRow.querySelector('.log-time');
                if (timeEl) timeEl.textContent = time;
                logEl.scrollTop = logEl.scrollHeight;
            }
            return;
        }
        lastLogMsg = msg;
        lastLogCount = 1;

        var row = document.createElement('div');
        row.className = 'log-row';

        var timeSpan = document.createElement('span');
        timeSpan.className = 'log-time';
        timeSpan.textContent = time;

        var iconSpan = document.createElement('span');
        iconSpan.className = 'log-icon';
        iconSpan.textContent = icon;

        var msgSpan = document.createElement('span');
        msgSpan.className = 'log-msg log-' + level;
        msgSpan.textContent = msg;

        row.appendChild(timeSpan);
        row.appendChild(iconSpan);
        row.appendChild(msgSpan);

         清除初始占位符（首个非 .log-row 的 SPAN 子节点）
        if (logEl.firstChild && logEl.firstChild.tagName === 'SPAN' && !logEl.firstChild.classList.contains('log-row')) {
            logEl.removeChild(logEl.firstChild);
        }
        logEl.appendChild(row);
        trimLog(logEl);
        logEl.scrollTop = logEl.scrollHeight;
    }

     [优化] 使用缓存的面板引用替代重复 querySelector
    function updateProgress(currentSec, durationSec, paused) {
        var pct = durationSec  0  Math.min(100, Math.round(currentSec  durationSec  100))  0;
        var fill = panelRefs.progressFill;
        var curEl = panelRefs.currentTime;
        var totEl = panelRefs.totalTime;
        var statusEl = panelRefs.status;
        var etaEl = panelRefs.eta;
        var etaSpan = panelRefs.etaSpan;
        if (fill) {
            fill.style.width = pct + '%';
            fill.className = (pct = 100)  'done'  '';
        }
        if (curEl) curEl.textContent = formatDuration(currentSec);
        if (totEl) totEl.textContent = formatDuration(durationSec);
        if (pct = 100) {
            setStatus(statusEl, 'stopped', '✅ 已完成');
        } else if (paused) {
            setStatus(statusEl, 'paused', '⏸ 暂停中');
        } else {
            setStatus(statusEl, 'playing', '▶ 播放中');
        }
        if (etaEl && etaSpan) {
            if (pct = 100) {
                etaEl.className = 'done';
                etaSpan.textContent = '已完成';
            } else if (durationSec  0 && currentSec  0 && !paused) {
                var remainingSec = Math.max(0, durationSec - currentSec);
                var etaDate = new Date(Date.now() + remainingSec  1000);
                var etaH = etaDate.getHours();
                var etaM = String(etaDate.getMinutes()).padStart(2, '0');
                etaSpan.textContent = etaH + '' + etaM;
                etaEl.className = '';
            } else if (paused) {
                etaSpan.textContent = '已暂停';
                etaEl.className = '';
            } else {
                etaSpan.textContent = '----';
                etaEl.className = '';
            }
        }
    }

     [优化] 移除未使用的 silent 参数
    function updateChapterInfo(completed, total, title) {
        dash.lastChapterCompleted = completed;
        dash.chapterCompleted = completed;
        dash.chapterTotal = total;
        dash.chapterTitle = title;
    }

     =============== 页面类型识别 ===============
    function detectPageType() {
        var hasLearnBtn = false;
        var btns = document.querySelectorAll('button');
        for (var i = 0; i  btns.length; i++) {
            if (btns[i].textContent.trim() === '学习') { hasLearnBtn = true; break; }
        }
        var hasVideo = !!document.querySelector('video');
        if (hasLearnBtn) return 'list';
        if (hasVideo) return 'play';
        return 'unknown';
    }
    function findChapterTitle() {
        var sels = ['h1', 'h2', 'h3', '.title', '[class=title]', '[class=chapter-name]', '[class=video-title]'];
        for (var i = 0; i  sels.length; i++) {
            var el = document.querySelector(sels[i]);
            if (el && el.textContent.trim().length  2 && el.textContent.trim().length  200) {
                return el.textContent.trim();
            }
        }
        var items = document.querySelectorAll('.active, .current, [class=active], [class=current], [class=playing]');
        for (var j = 0; j  items.length; j++) {
            var t = items[j].textContent.trim();
            if (t.length  2 && t.length  200 && !已完成已学.test(t)) return t;
        }
        return '';
    }

     [优化] 缩小扫描范围：从全页 div 缩小到候选容器选择器
    function tryCountTotalFromDOM() {
        var candidates = document.querySelectorAll(
            'ul, ol, ' +
            '[class=chapter], [class=section], [class=lesson], ' +
            '[class=course], [class=list], [class=catalog], ' +
            '[class=item], [role=list], [role=group]'
        );
        var bestCount = 0;

         第一轮：查找含 XY 格式文本且有多个子项的容器
        for (var i = 0; i  candidates.length; i++) {
            var d = candidates[i];
            var txt = d.textContent;
            var m = txt.match((d+)ss(d+));
            if (m && parseInt(m[2])  parseInt(m[1])) {
                var children = d.querySelectorAll('li, [class=item], [class=chapter]');
                if (children.length = 2 && children.length  bestCount) {
                    bestCount = children.length;
                }
            }
        }

         第二轮：查找含 已完成 标记的列表容器
        if (bestCount  2) {
            for (var j = 0; j  candidates.length; j++) {
                var div = candidates[j];
                var items = div.querySelectorAll('li, [class=item], [class=chapter]');
                if (items.length = 2) {
                    var doneCount = 0;
                    for (var k = 0; k  items.length; k++) {
                        var itemText = items[k].textContent;
                        if (itemText.indexOf('已完成') !== -1  itemText.indexOf('已学') !== -1 
                            completeddonefinishi.test(items[k].className  '')) {
                            doneCount++;
                        }
                    }
                    if (doneCount  0 && items.length  bestCount) {
                        bestCount = items.length;
                    }
                }
            }
        }
        return bestCount = 2  bestCount  0;
    }

     =============== 列表页功能 ===============
     [优化] forEach 替换为 for 循环
    function findCourseCards() {
        var cards = [];
        var btns = document.querySelectorAll('button');
        for (var i = 0; i  btns.length; i++) {
            var btn = btns[i];
            if (btn.textContent.trim() === '学习') {
                var card = btn.closest('div[class=course], div[class=item], li, div[class=card]')  btn.parentElement;
                cards.push({ button btn, card card });
            }
        }
        return cards;
    }
     [优化] forEach 替换为 for 循环
    function extractCourseInfo(cardData) {
        var card = cardData.card;
        var progress = 0, title = '';
        var pEl = card.querySelector('[class=progress] span, [class=schedule] span, [class=percent]');
        if (pEl) { var m = pEl.textContent.match((d+(.d+))%); if (m) progress = parseFloat(m[1]); }
        if (progress === 0) {
            var spans = card.querySelectorAll('span');
            for (var si = 0; si  spans.length; si++) {
                if (^d+(.d+)%$.test(spans[si].textContent.trim())) {
                    progress = parseFloat(spans[si].textContent.trim());
                    break;
                }
            }
        }
        if (progress === 0) {
            var el = card.querySelector('[data-progress], [data-schedule]');
            if (el) { var v = el.getAttribute('data-progress')  el.getAttribute('data-schedule'); if (v) progress = parseFloat(v); }
        }
        if (progress === 0) {
            var m2 = card.textContent.match((d+(.d+))%); if (m2) progress = parseFloat(m2[1]);
        }
        var h3 = card.querySelector('h3, h2, .title, [class=title]');
        if (h3) title = h3.textContent.trim();
        if (!title) {
            var divs = card.querySelectorAll('div');
            for (var di = 0; di  divs.length; di++) {
                var t = divs[di].textContent.trim();
                if (t.length  5 && t.length  150 && t.indexOf('%') === -1) { title = t; break; }
            }
        }
        if (!title) title = card.textContent.substring(0, 60).trim();
        return { button cardData.button, card card, progress progress, title title };
    }
     [优化] 使用 panelRefs.status 替代 querySelector
    function scanAndEnterCourse() {
        if (!enabled) return;
        var cards = findCourseCards();
        if (cards.length === 0) { allCompletedCount = 0; return; }
        var courses = cards.map(extractCourseInfo);
        var allCompleted = true;
        for (var i = 0; i  courses.length; i++) {
            if (courses[i].progress  CONFIG.completedThreshold) { allCompleted = false; break; }
        }
        if (allCompleted) {
            allCompletedCount++;
            if (allCompletedCount = CONFIG.allCompletedStopCount) {
                dashLog('✅', '所有课程已完成，停止巡检');
                enabled = false;
                setStatus(panelRefs.status, 'stopped', '✅ 全部完成');
                if (timers.scan) { clearInterval(timers.scan); timers.scan = null; }
            }
            return;
        }
        allCompletedCount = 0;
        for (var j = 0; j  courses.length; j++) {
            if (courses[j].progress  CONFIG.completedThreshold) {
                dashLog('🎯', '进入课程 ' + courses[j].title + ' (' + courses[j].progress + '%)');
                courses[j].button.click();
                return;
            }
        }
    }

     =============== 章节完成检测 ===============
     [优化] forEach 替换为 for 循环
    function checkChapterCompletion() {
        if (!enabled) return;
        var completed = 0, total = 0;
        var targetList = null;
        var lists = document.querySelectorAll('ul, ol, div[class=chapter-list], div[class=section-list]');
        for (var i = 0; i  lists.length; i++) {
            var items = lists[i].querySelectorAll('li, div[class=chapter-item], div[class=section-item]');
            if (items.length = 2) {
                var hasStatus = false;
                for (var t = 0; t  items.length; t++) {
                    if (items[t].querySelector('svg, i, [class=icon]') 
                        items[t].textContent.indexOf('已完成') !== -1 
                        items[t].textContent.indexOf('已学') !== -1) { hasStatus = true; break; }
                }
                if (hasStatus) { targetList = lists[i]; break; }
            }
        }
        if (!targetList) {
            var divs = document.querySelectorAll('div');
            for (var k = 0; k  divs.length; k++) {
                if (divs[k].textContent.indexOf('已完成') !== -1 && divs[k].children.length  1) {
                    targetList = divs[k]; break;
                }
            }
        }
        if (targetList) {
            var items = targetList.querySelectorAll('li, div[class=chapter-item], div[class=section-item], div[class=item]');
            if (items.length = 1) {
                total = items.length;
                for (var ci = 0; ci  items.length; ci++) {
                    var item = items[ci];
                    var greenSvg = item.querySelector('svg path[fill=#52c41a], svg path[fill=#27ae60], svg path[fill=#10b981]');
                    var hasText = item.textContent.indexOf('已完成') !== -1  item.textContent.indexOf('已学') !== -1;
                    var cls = item.className  '';
                    var hasCls = completeddonefinishcheckedi.test(cls);
                    var aria = item.getAttribute('aria-checked')  item.getAttribute('data-status')  item.getAttribute('aria-selected');
                    var isAttr = (aria === 'true'  aria === 'completed'  aria === 'finished'  aria === 'selected');
                    var ds = item.getAttribute('data-status');
                    var isDs = ds && ['finished','completed','done'].indexOf(ds.toLowerCase()) !== -1;
                    if (greenSvg  hasText  hasCls  isAttr  isDs) completed++;
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
            if (dash.endedCount  completed) {
                completed = dash.endedCount;
                if (completed  total) completed = total;
            }
        }
        var chTitle = findChapterTitle();
        updateChapterInfo(completed, total, chTitle);
        if (total  0 && completed = total) {
            dashLog('📖', '所有章节已完成，等待评价弹窗...');
            if (timers.check) { clearInterval(timers.check); timers.check = null; }
        }
    }

     =============== 弹窗检测 ===============
     [优化] 提取重复的弹窗处理代码为辅助函数
    function closePopupAndReturn(btn) {
        btn.click();
        dashLog('🔙', '2秒后返回列表页...');
        setTimeout(function () { goBack(); }, CONFIG.returnDelay);
        if (timers.popup) { clearInterval(timers.popup); timers.popup = null; }
        popupRetryCount = 0;
    }

     [优化] 使用 TreeWalker 替代全页 div 遍历；使用 CONFIG.popupMaxRetry
    function checkAndHandlePopup() {
        if (!enabled) return;
        var modal = null;
        var sels = ['.el-dialog', '.ant-modal', '.modal', '.dialog', 'div[role=dialog]', 'div[class=popup]', 'div[class=modal]'];
        for (var s = 0; s  sels.length; s++) {
            var el = document.querySelector(sels[s]);
            if (el && (el.textContent.indexOf('评价') !== -1  el.textContent.indexOf('评分') !== -1)) { modal = el; break; }
        }
        if (!modal) {
             [优化] 使用 TreeWalker 精确查找文本节点，而非遍历所有 div 的 textContent
            var walker = document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_TEXT,
                {
                    acceptNode function (node) {
                        var t = node.textContent;
                        if (t.indexOf('请您对该课程进行评价') !== -1  t.indexOf('课程评价') !== -1) {
                            return NodeFilter.FILTER_ACCEPT;
                        }
                        return NodeFilter.FILTER_SKIP;
                    }
                }
            );
            var textNode = walker.nextNode();
            if (textNode) {
                 向上找到最近的对话框容器
                var parent = textNode.parentNode;
                while (parent && parent !== document.body) {
                    if (parent.tagName === 'DIV' && parent.children.length  0) {
                        modal = parent;
                        break;
                    }
                    parent = parent.parentNode;
                }
            }
        }
        if (!modal) { popupRetryCount = 0; return; }
        var btns = modal.querySelectorAll('button');
        for (var b = 0; b  btns.length; b++) {
            var text = btns[b].textContent.trim();
            if (^(好的确定确认OK是我知道了)$i.test(text)) {
                dashLog('💬', '自动关闭评价弹窗 (点击' + text + ')');
                closePopupAndReturn(btns[b]);
                return;
            }
        }
        if (btns.length  0) {
            dashLog('💬', '尝试点击弹窗按钮...');
            closePopupAndReturn(btns[0]);
            return;
        }
        popupRetryCount++;
        if (popupRetryCount = CONFIG.popupMaxRetry) {
            dashLog('⚠️', '弹窗按钮不可用，强制返回');
            goBack();
            if (timers.popup) { clearInterval(timers.popup); timers.popup = null; }
            popupRetryCount = 0;
        }
    }

     [优化] 增加 URL 路径推断，改进 SPA 导航回退
    function goBack() {
        var sels = ['a[href=plan]', 'a[href=return]', 'a[class=back]', 'button[class=back]', '[class=back-btn]'];
        for (var i = 0; i  sels.length; i++) {
            var el = document.querySelector(sels[i]);
            if (el) { el.click(); return; }
        }
        var links = document.querySelectorAll('nav a, header a, .breadcrumb a');
        for (var j = 0; j  links.length; j++) {
            if (返回计划列表i.test(links[j].textContent)) { links[j].click(); return; }
        }

         尝试从当前 URL 推断列表页地址
        var currentPath = location.pathname;
        var pathSegments = currentPath.split('').filter(Boolean);
        if (pathSegments.length  1) {
            pathSegments.pop();  移除最后一段（通常是视频章节 ID）
            var listUrl = location.origin + '' + pathSegments.join('');
            dashLog('🔗', '尝试导航到列表页 ' + listUrl);
            location.href = listUrl;
            return;
        }

         最终回退：history.back()
        if (window.history.length  1) {
            dashLog('🔙', '使用浏览器历史返回');
            window.history.back();
        }
    }

     =============== 视频控制 ===============
    function setupVideoControl() {
        var video = document.querySelector('video');
        if (!video) { dashLog('⚠️', '未找到视频元素'); return null; }

        var destroyed       = false;
        var userInteracted  = false;
        var playStartTime   = null;
        var totalPlayTime   = 0;
        var lastDashUpdate  = 0;
        var hasClickedMute  = false;

        var control = {
            video video,
            eventListeners [],
            heartbeatTimer null,
            visibilityHandler null,

             [优化] 合并 playbackRate 强制逻辑为统一方法
            enforceNormalSpeed function () {
                if (destroyed) return;
                if (video.playbackRate !== 1.0) {
                    video.playbackRate = 1.0;
                }
            },

             点击播放器静音按钮（每个视频仅点击一次）
            clickMuteButton function () {
                if (destroyed  hasClickedMute) return;
                var muteBtn = document.querySelector('button.pv-volumebtn');
                if (muteBtn) {
                    muteBtn.click();
                    hasClickedMute = true;
                    video.muted = true;
                    dashLog('🔇', '已点击静音按钮');
                } else {
                    video.muted = true;
                }
            },

            init function () {
                dash.chapterCompleted = 0;
                dash.chapterTotal = 0;

                var dur = video.duration  0;
                var cur = video.currentTime  0;
                updateProgress(cur, dur, video.paused);

                var chTitle = findChapterTitle();
                if (chTitle) dash.chapterTitle = chTitle;
                updateChapterInfo(dash.endedCount, 0, dash.chapterTitle);

                 --- 处理元数据加载日志（每个视频只输出一次） ---
                if (video.dataset.dcMetadataLogged !== 'true') {
                    if (dur  0) {
                        video.dataset.dcMetadataLogged = 'true';
                        dashLog('🎬', '视频元数据加载完成  总时长 ' + formatDuration(dur));
                    } else {
                        var metadataHandler = function () {
                            if (destroyed) return;
                            if (video.dataset.dcMetadataLogged !== 'true') {
                                video.dataset.dcMetadataLogged = 'true';
                                dashLog('🎬', '视频元数据加载完成  总时长 ' + formatDuration(video.duration));
                            }
                        };
                        video.addEventListener('loadedmetadata', metadataHandler, { once true });
                        control.eventListeners.push({ event 'loadedmetadata', handler metadataHandler });
                    }
                }

                var playHandler = function () {
                    if (destroyed) return;
                    control.enforceNormalSpeed();
                    playStartTime = Date.now();
                    lastDashUpdate = 0;
                    if (!userInteracted) {
                        dashLog('▶️', '开始播放' + (video.currentTime  0  ' (从 ' + formatDuration(video.currentTime) + ' 处恢复)'  ''));
                    }
                    userInteracted = true;
                     播放时默认点击静音按钮
                    control.clickMuteButton();
                    updateProgress(video.currentTime, video.duration, false);
                };

                var pauseHandler = function () {
                    if (destroyed  !enabled) return;
                    if (video.ended) return;
                    var now = Date.now();
                    if (playStartTime) { totalPlayTime += (now - playStartTime)  1000; playStartTime = null; }
                    updateProgress(video.currentTime, video.duration, true);
                    dashLog('⏸', '视频暂停，自动恢复中... (' + formatDuration(video.currentTime) + '  ' + formatDuration(video.duration) + ')');
                    setTimeout(function () {
                        if (!destroyed && enabled && !video.ended && video.paused) control.resumeByClick();
                    }, CONFIG.resumeRetryDelay);
                };

                var endedHandler = function () {
                    if (destroyed) return;
                    if (playStartTime) { totalPlayTime += (Date.now() - playStartTime)  1000; playStartTime = null; }
                    updateProgress(video.duration, video.duration, false);
                    dash.endedCount++;
                    dashLog('🏁', '第' + dash.endedCount + '个章节播放完毕  时长 ' + formatDuration(totalPlayTime));
                    totalPlayTime = 0;
                    if (dash.chapterTotal === 0) {
                        updateChapterInfo(dash.endedCount, 0, dash.chapterTitle);
                    }
                    setTimeout(function () { checkChapterCompletion(); }, CONFIG.chapterCheckDelay);
                };

                var timeupdateHandler = function () {
                    if (destroyed) return;
                    control.enforceNormalSpeed();
                    var now = Date.now();
                    if (now - lastDashUpdate  CONFIG.dashUpdateInterval) {
                        lastDashUpdate = now;
                        updateProgress(video.currentTime, video.duration, video.paused);
                    }
                };

                video.addEventListener('play',       playHandler);
                video.addEventListener('pause',      pauseHandler);
                video.addEventListener('ended',      endedHandler);
                video.addEventListener('timeupdate', timeupdateHandler);
                control.eventListeners.push({ event 'play', handler playHandler });
                control.eventListeners.push({ event 'pause', handler pauseHandler });
                control.eventListeners.push({ event 'ended', handler endedHandler });
                control.eventListeners.push({ event 'timeupdate', handler timeupdateHandler });

                var clickHandler = function () { if (!userInteracted) userInteracted = true; };
                document.addEventListener('click', clickHandler, true);
                control.eventListeners.push({ event 'click', handler clickHandler, capture true, target document });

                control.visibilityHandler = function () {
                    if (destroyed  !enabled) return;
                    if (!document.hidden) {
                        setTimeout(function () {
                             [修复] 移除 userInteracted 门槛：窗口还原时无论视频是否播放过都尝试恢复，
                             避免未播放过的新视频在最小化后偷停
                            if (!destroyed && enabled && !video.ended && video.paused)
                                control.resumeByClick(true);
                        }, CONFIG.visibilityResumeDelay);
                    }
                };
                document.addEventListener('visibilitychange', control.visibilityHandler);

                control.heartbeatTimer = setInterval(function () {
                    if (destroyed  !enabled) return;
                    control.enforceNormalSpeed();
                     [修复] 移除 userInteracted 门槛：未播放过的新视频最小化后也会被浏览器暂停，
                     心跳需无条件尝试恢复，否则会偷停。play().catch() 会静默处理浏览器拒绝的情况。
                    if (video.paused && !video.ended) {
                        video.muted = true;
                         优先点击播放器播放按钮
                        var playBtn = document.querySelector('button.pv-playpause');
                        if (playBtn) playBtn.click();
                        control.simulateClick();
                        video.play().catch(function () {});
                    }
                    if (!video.paused) updateProgress(video.currentTime, video.duration, false);
                }, CONFIG.heartbeatInterval);

                setTimeout(function () {
                    if (!destroyed && enabled && video.paused && !video.ended) {
                        video.muted = true;
                        control.enforceNormalSpeed();
                        control.simulateClick();
                        video.play().catch(function () {});
                    }
                     延迟点击静音按钮，确保播放器控件已渲染
                    if (!destroyed) {
                        setTimeout(function () { control.clickMuteButton(); }, 500);
                    }
                }, CONFIG.initDelay);

                 修复：如果视频已经在播放状态，主动输出日志
                setTimeout(function () {
                    if (destroyed) return;
                    if (!video.paused && !userInteracted) {
                        userInteracted = true;
                        playStartTime = Date.now();
                        lastDashUpdate = 0;
                        dashLog('▶️', '开始播放' + (video.currentTime  0  ' (从 ' + formatDuration(video.currentTime) + ' 处恢复)'  ''));
                        updateProgress(video.currentTime, video.duration, false);
                    }
                }, CONFIG.playStateCheckDelay);

                setStatus(panelRefs.status, 'playing', '▶ 播放中');
            },

             [优化] Touch API 特性检测；MouseEvent 分发移出 trycatch
            simulateClick function () {
                var rect = video.getBoundingClientRect();
                var cx = rect.left + rect.width  2;
                var cy = rect.top + rect.height  2;

                 MouseEvent 分发（所有浏览器支持）
                var mouseEvents = ['mouseenter', 'mouseover', 'mousedown', 'mouseup', 'click'];
                for (var i = 0; i  mouseEvents.length; i++) {
                    video.dispatchEvent(new MouseEvent(mouseEvents[i], {
                        bubbles true, cancelable true, view window,
                        clientX cx, clientY cy, button 0
                    }));
                }

                 TouchEvent 分发（特性检测，仅支持时执行）
                if (typeof TouchEvent !== 'undefined' && typeof Touch !== 'undefined') {
                    try {
                        var touch = new Touch({
                            identifier Date.now(), target video,
                            clientX cx, clientY cy, pageX cx, pageY cy,
                            radiusX 1, radiusY 1, rotationAngle 0, force 1
                        });
                        video.dispatchEvent(new TouchEvent('touchstart', {
                            bubbles true, cancelable true, view window,
                            touches [touch], targetTouches [touch], changedTouches [touch]
                        }));
                        video.dispatchEvent(new TouchEvent('touchend', {
                            bubbles true, cancelable true, view window,
                            touches [], targetTouches [], changedTouches [touch]
                        }));
                    } catch (e) {}
                }
            },

            resumeByClick function (silent) {
                if (destroyed  !enabled) return;
                var v = this.video;
                if (!v  v.ended) return;
                this.enforceNormalSpeed();
                if (!v.paused) {
                    updateProgress(v.currentTime, v.duration, false);
                    return;
                }
                 [修复] 移除 document.hidden && !userInteracted 守卫：
                 后台时也应尝试恢复未播放过的视频，由下方 play().catch() 兜底处理浏览器拒绝
                v.muted = true;

                 优先点击播放器的播放按钮（pv-playpause），触发播放器内部状态切换
                var playBtn = document.querySelector('button.pv-playpause');
                if (playBtn) {
                    playBtn.click();
                }
                 同时模拟点击视频区域 + 调用 play() 作为兜底
                this.simulateClick();
                var self = this;
                v.play().then(function () {
                    if (!silent) dashLog('▶️', '恢复播放成功');
                    if (!playStartTime) playStartTime = Date.now();
                    updateProgress(v.currentTime, v.duration, false);
                }).catch(function (e) {
                     play() 被拒绝时，再次尝试点击播放按钮
                    if (playBtn) playBtn.click();
                    self.simulateClick();
                    v.play().catch(function () {});
                });
            },

             [优化] forEach 替换为 for 循环
            destroy function () {
                destroyed = true;
                if (playStartTime && !video.ended) { totalPlayTime += (Date.now() - playStartTime)  1000; playStartTime = null; }
                if (this.heartbeatTimer)   { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
                if (this.visibilityHandler) { document.removeEventListener('visibilitychange', this.visibilityHandler); this.visibilityHandler = null; }
                for (var i = 0; i  this.eventListeners.length; i++) {
                    var item = this.eventListeners[i];
                    (item.target  video).removeEventListener(item.event, item.handler, item.capture  false);
                }
                this.eventListeners = [];
                dash.chapterCompleted = 0;
                dash.chapterTotal = 0;
            }
        };

        control.init();
        return control;
    }

     =============== 页面切换调度 ===============
     [优化] 使用 panelRefs.status；使用时间戳节流替代 isReinitializing
    function onPageTypeChange(newType, force) {
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
                lastVideoSrc = video.src  video.getAttribute('src')  '';
                lastVideoDuration = video.duration  0;
            }
            dashLog('🎬', '进入播放页');
            videoControlInstance = setupVideoControl();
            timers.check = setInterval(checkChapterCompletion, CONFIG.checkInterval);
            timers.popup = setInterval(checkAndHandlePopup, CONFIG.popupCheckInterval);
            if (timers.videoMonitor) clearInterval(timers.videoMonitor);
            timers.videoMonitor = setInterval(function () {
                if (!enabled  currentPageType !== 'play') return;
                var v = document.querySelector('video');
                if (!v) return;
                var currentSrc = v.src  v.getAttribute('src')  '';
                var currentDuration = v.duration  0;
                if ((currentSrc && currentSrc !== lastVideoSrc) 
                    (currentDuration  0 && currentDuration !== lastVideoDuration)) {
                    lastVideoSrc = currentSrc;
                    lastVideoDuration = currentDuration;
                    updateProgress(v.currentTime  0, currentDuration, v.paused);
                     [优化] 使用时间戳节流替代布尔标志，避免竞态条件
                    var now = Date.now();
                    if (now - lastReinitTime = CONFIG.reinitGuardDelay) {
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

     =============== 页面检测 ===============
     [优化] MutationObserver 过滤面板自身变动；防抖使用 CONFIG.observerDebounce
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
             [优化] 过滤掉面板自身的 DOM 变动
            var hasExternalChange = false;
            for (var i = 0; i  mutations.length; i++) {
                if (!panel  !panel.contains(mutations[i].target)) {
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
        pageObserver.observe(document.body, { childList true, subtree true, attributes false });

        setTimeout(function () {
            onPageTypeChange(detectPageType());
            isInitialized = true;
        }, CONFIG.initDelay);
    }

     [优化] 移除多余的 clearTimeout；forEach 替换为 for 循环
    function clearAllTimers() {
        var keys = Object.keys(timers);
        for (var i = 0; i  keys.length; i++) {
            var key = keys[i];
            if (timers[key]) { clearInterval(timers[key]); timers[key] = null; }
        }
        if (videoControlInstance) { videoControlInstance.destroy(); videoControlInstance = null; }
        if (pageObserver) { pageObserver.disconnect(); pageObserver = null; }
    }

     =============== 菜单 ===============
     [优化] 使用 panelRefs.status 替代 querySelector
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

     =============== 初始化 ===============
    function init() {
        createPanel();
        registerMenuCommands();
        startPageDetection();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
