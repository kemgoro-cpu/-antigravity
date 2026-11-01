/* A bounded, accessible split view for the time chart and XY/map panel. */
(function (root) {
    'use strict';
    const HANDLE = 8, MIN_PANE = 320, STACK_BELOW = 720, DEFAULT_RATIO = 0.5;
    const ratioValue = value => Number.isFinite(value) ? Math.max(0.2, Math.min(0.8, value)) : DEFAULT_RATIO;

    function measureSplit(width, requestedRatio = DEFAULT_RATIO) {
        width = Number.isFinite(width) ? Math.max(0, width) : 0;
        const ratio = ratioValue(requestedRatio), available = Math.max(0, width - HANDLE);
        const stacked = width < STACK_BELOW;
        const min = stacked ? 0 : MIN_PANE, max = stacked ? available : available - MIN_PANE;
        const mapWidth = stacked ? width : Math.round(Math.max(min, Math.min(max, available * ratio)));
        return { stacked, ratio, available, mapWidth, waveWidth: stacked ? width : available - mapWidth,
            minRatio: available ? Math.max(0.2, min / available) : 0.2, maxRatio: available ? Math.min(0.8, max / available) : 0.8 };
    }

    function createLayout({ panel, container = panel.parentElement, ratio = DEFAULT_RATIO, onResize, onCommit } = {}) {
        if (!panel || !container) throw new Error('XY layout requires a panel and its container');
        const document = panel.ownerDocument || root.document;
        const handle = document.createElement('div');
        handle.id = 'xy-split-handle'; handle.className = 'xy-split-handle hidden'; handle.tabIndex = 0;
        handle.setAttribute('role', 'separator'); handle.setAttribute('aria-orientation', 'vertical');
        handle.setAttribute('aria-label', '波形とマップの幅を調整'); handle.setAttribute('aria-controls', panel.id);
        handle.title = 'ドラッグで幅を調整。左右キーで移動、Home/Endで最小/最大、ダブルクリックで半分に戻す';
        container.insertBefore(handle, panel);
        const hint = document.createElement('p'); hint.className = 'xy-layout-hint';
        // Navigation guidance belongs after the plot; it must not consume the
        // limited initial chart height in a docked workspace.
        (panel.querySelector('.xy-workspace-content') || panel).appendChild(hint);
        let preferredRatio = ratioValue(ratio), visible = false, expanded = false, disposed = false;
        let frame = null, drag = null, lastSize = '', appliedWidth = null, viewportHeight = null, revealPending = false;

        function schedule() {
            if (disposed || frame !== null) return;
            frame = root.requestAnimationFrame(sync);
        }
        function sync() {
            frame = null;
            if (disposed) return;
            const box = container.getBoundingClientRect(), size = measureSplit(box.width, preferredRatio);
            container.classList.toggle('xy-layout-active', visible);
            container.classList.toggle('xy-layout-stacked', visible && size.stacked);
            container.classList.toggle('xy-layout-expanded', visible && expanded);
            const enabled = visible && !expanded && !size.stacked;
            handle.classList.toggle('hidden', !enabled); handle.tabIndex = enabled ? 0 : -1;
            handle.setAttribute('aria-disabled', String(!enabled));
            handle.setAttribute('aria-valuemin', String(Math.ceil(size.minRatio * 100)));
            handle.setAttribute('aria-valuemax', String(Math.floor(size.maxRatio * 100)));
            handle.setAttribute('aria-valuenow', String(size.available ? Math.round(size.mapWidth / size.available * 100) : 50));
            handle.setAttribute('aria-valuetext', `マップの幅 ${size.available ? Math.round(size.mapWidth / size.available * 100) : 50}%`);
            if (appliedWidth !== size.mapWidth) {
                appliedWidth = size.mapWidth;
                panel.style.setProperty('--xy-pane-width', size.mapWidth + 'px');
            }
            const availableHeight = Math.max(0, Math.round(box.height));
            if (viewportHeight !== availableHeight) {
                viewportHeight = availableHeight;
                panel.style.setProperty('--xy-viewport-height', availableHeight + 'px');
            }
            const message = expanded ? '「並べて表示に戻る」で、波形とマップを並べます。'
                : size.stacked ? '表示領域が狭いため上下に並べています。ウィンドウを広げるか左サイドバーを閉じると左右分割になります。'
                : '左右分割：境界をドラッグして幅を調整できます。境界を選んで左右キーでも調整できます。';
            if (hint.textContent !== message) hint.textContent = message;
            // Reading after applying layout gives the effective pane sizes, not
            // merely the requested ratio. A same-size observer notification does
            // not trigger another pair of chart resizes.
            const wave = container.querySelector('.chart-container'), mapBox = panel.getBoundingClientRect(), waveBox = wave?.getBoundingClientRect();
            if (revealPending) {
                revealPending = false;
                if (visible && size.stacked) container.scrollTop = Math.max(0, (container.scrollTop || 0) + mapBox.top - box.top);
            }
            const signature = JSON.stringify([visible, expanded, size.stacked,
                Math.round(mapBox.width), Math.round(mapBox.height), Math.round(waveBox?.width || 0), Math.round(waveBox?.height || 0)]);
            if (signature !== lastSize) { lastSize = signature; onResize?.(); }
        }
        function commit() { onCommit?.(preferredRatio); }
        function endDrag(event, save = true) {
            if (!drag || (event && event.pointerId !== drag.id)) return;
            const pointer = drag.id; drag = null;
            container.classList.remove('xy-layout-dragging');
            if (handle.hasPointerCapture?.(pointer)) handle.releasePointerCapture(pointer);
            if (save) commit();
        }
        function pointerDown(event) {
            if (event.button !== 0 || !visible || expanded) return;
            const box = container.getBoundingClientRect();
            if (measureSplit(box.width, preferredRatio).stacked) return;
            event.preventDefault();
            drag = { id: event.pointerId };
            handle.setPointerCapture?.(event.pointerId); handle.focus();
            container.classList.add('xy-layout-dragging');
        }
        function pointerMove(event) {
            if (!drag || event.pointerId !== drag.id) return;
            const box = container.getBoundingClientRect(), size = measureSplit(box.width, preferredRatio);
            if (size.stacked) { endDrag(event); return; }
            // The map is on the right, hence dragging the divider left grows it.
            const desired = (box.right - event.clientX - HANDLE / 2) / size.available;
            preferredRatio = ratioValue(Math.max(size.minRatio, Math.min(size.maxRatio, desired)));
            schedule();
        }
        function keyDown(event) {
            if (!visible || expanded) return;
            const size = measureSplit(container.getBoundingClientRect().width, preferredRatio);
            if (size.stacked) return;
            let next;
            const current = size.mapWidth / size.available, step = (event.shiftKey ? 60 : 20) / size.available;
            if (event.key === 'ArrowLeft') next = current + step;
            else if (event.key === 'ArrowRight') next = current - step;
            else if (event.key === 'Home') next = size.minRatio;
            else if (event.key === 'End') next = size.maxRatio;
            else return;
            event.preventDefault();
            preferredRatio = ratioValue(Math.max(size.minRatio, Math.min(size.maxRatio, next)));
            schedule(); commit();
        }
        function half() { preferredRatio = DEFAULT_RATIO; schedule(); commit(); }
        const listeners = { pointerdown: pointerDown, pointermove: pointerMove, pointerup: endDrag, pointercancel: endDrag,
            lostpointercapture: event => endDrag(event), keydown: keyDown, dblclick: half };
        for (const [name, listener] of Object.entries(listeners)) handle.addEventListener(name, listener);
        const observer = new root.ResizeObserver(schedule); observer.observe(container);
        schedule();
        return {
            setState(next) {
                if (typeof next?.visible === 'boolean') visible = next.visible;
                if (typeof next?.expanded === 'boolean') expanded = next.expanded;
                if (next?.reveal) revealPending = true;
                if ((!visible || expanded) && drag) endDrag(null);
                schedule();
            },
            setRatio(value) { preferredRatio = ratioValue(value); schedule(); },
            getRatio() { return preferredRatio; },
            destroy() {
                if (disposed) return;
                disposed = true; if (frame !== null) root.cancelAnimationFrame(frame);
                observer.disconnect(); endDrag(null, false);
                for (const [name, listener] of Object.entries(listeners)) handle.removeEventListener(name, listener);
                handle.remove(); hint.remove(); panel.style.removeProperty('--xy-pane-width'); panel.style.removeProperty('--xy-viewport-height');
                container.classList.remove('xy-layout-active', 'xy-layout-stacked', 'xy-layout-expanded', 'xy-layout-dragging');
            }
        };
    }
    root.CSVXYLayout = createLayout;
    if (typeof module !== 'undefined' && module.exports) module.exports = { measureSplit, createLayout };
})(typeof window !== 'undefined' ? window : globalThis);
