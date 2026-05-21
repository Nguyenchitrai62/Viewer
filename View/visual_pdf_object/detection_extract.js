(function () {
    const detectExtractPanel = document.getElementById('detect-extract-panel');
    const btnToggleDetectExtractPanel = document.getElementById('btn-toggle-detect-extract-panel');
    const detectExtractCountBadge = document.getElementById('detect-extract-count-badge');
    const detectExtractStatus = document.getElementById('detect-extract-status');
    const detectExtractSummary = document.getElementById('detect-extract-summary');
    const extractLineStageCount = document.getElementById('extract-line-stage-count');
    const extractTextStageCount = document.getElementById('extract-text-stage-count');
    const extractSymbolStageCount = document.getElementById('extract-symbol-stage-count');
    const extractMergeStageCount = document.getElementById('extract-merge-stage-count');
    const btnDetectViewProcessed = document.getElementById('btn-detect-view-processed');
    const btnDetectViewRaw = document.getElementById('btn-detect-view-raw');
    const btnDetectViewFinal = document.getElementById('btn-detect-view-final');
    const btnExtractOverlayLine = document.getElementById('btn-extract-overlay-line');
    const btnExtractOverlayText = document.getElementById('btn-extract-overlay-text');
    const btnExtractOverlaySymbol = document.getElementById('btn-extract-overlay-symbol');
    const btnExtractOverlayMerge = document.getElementById('btn-extract-overlay-merge');
    const btnExtractLineSourceFinal = document.getElementById('btn-extract-line-source-final');
    const btnExtractLineSourcePanel = document.getElementById('btn-extract-line-source-panel');
    const btnExtractSymbolSourcePanel = document.getElementById('btn-extract-symbol-source-panel');
    const btnExtractSymbolSourceApi = document.getElementById('btn-extract-symbol-source-api');
    const btnExtractSymbolSourceBoth = document.getElementById('btn-extract-symbol-source-both');
    const btnRunDetectExtract = document.getElementById('btn-run-detect-extract');
    const btnPromoteExtractLineToLabels = document.getElementById('btn-promote-extract-line-to-labels');
    const btnRunExtractFireText = document.getElementById('btn-run-extract-fire-text');
    const btnRunExtractFireSymbol = document.getElementById('btn-run-extract-fire-symbol');
    const btnRunExtractFireMerge = document.getElementById('btn-run-extract-fire-merge');
    const btnExportExtractFireJson = document.getElementById('btn-export-extract-fire-json');
    const btnClearDetectExtract = document.getElementById('btn-clear-detect-extract');

    const DETECTION_PANEL_STORAGE_KEY = 'visual_pdf_object.detect_extract_collapsed';
    const DETECTION_VIEW_MODE_RAW = 'raw';
        const DETECTION_VIEW_MODE_PROCESSED = 'processed';
    const DETECTION_VIEW_MODE_FINAL = 'final';
    const EXTRACT_FIRE_STAGE_LINE = 'line';
    const EXTRACT_FIRE_STAGE_TEXT = 'text';
    const EXTRACT_FIRE_STAGE_SYMBOL = 'symbol';
    const EXTRACT_FIRE_STAGE_MERGE = 'merge';
    const EXTRACT_FIRE_LINE_SOURCE_FINAL = 'final';
    const EXTRACT_FIRE_LINE_SOURCE_PANEL = 'panel';
    const EXTRACT_FIRE_SYMBOL_SOURCE_PANEL = 'panel';
    const EXTRACT_FIRE_SYMBOL_SOURCE_API = 'api';
    const EXTRACT_FIRE_SYMBOL_SOURCE_BOTH = 'both';
    const EXTRACT_FIRE_IMPORTED_SYMBOL_LABEL_NAME = 'Sprinkler';
    const EXTRACT_FIRE_IMPORTED_SYMBOL_COLOR = '#ea580c';
    const DETECTION_LAYER_PREFIX = 'Detect: ';
    const DETECTION_RENDER_PRIORITY = 2;
    const DETECTION_DEFAULT_SEARCH_PADDING = 5;
    const DETECTION_CONNECT_VERIFY_MIN_COVERAGE_RATIO = Number.isFinite(Number(CONFIG.DETECTION_CONNECT_VERIFY_MIN_COVERAGE_RATIO))
        ? Number(CONFIG.DETECTION_CONNECT_VERIFY_MIN_COVERAGE_RATIO)
        : 0.6;
    const DETECTION_MIN_LINE_COVERAGE_RATIO = DETECTION_CONNECT_VERIFY_MIN_COVERAGE_RATIO;
    const DETECTION_PARALLEL_MAX_ANGLE_DEGREES = 5;
    const DETECTION_MERGE_AXIS_OFFSET = 1;
    const DETECTION_MERGE_ENDPOINT_GAP = 4;
    const DETECTION_CLASS_COLORS = Object.freeze({
        connect: [0.06, 0.46, 0.43],
        junction: [0.86, 0.16, 0.24],
        valve: [0.15, 0.39, 0.92],
        sprinkler: [0.93, 0.36, 0.12],
        default: [0.49, 0.27, 0.95]
    });
    const DETECTION_ANNOTATION_COLORS = Object.freeze({
        connect: '#0ea5e9',
        junction: '#ef4444'
    });
    const EXTRACT_FIRE_OVERLAY_COLORS = Object.freeze({
        text: '#9333ea',
        symbol: '#ea580c',
        mergeLine: '#16a34a',
        mergeNode: '#dc2626',
        mergeSymbol: '#0891b2'
    });
    const DETECTION_CACHE_BOUNDS_EPSILON = 1e-4;
    const DETECTION_CACHE_SCALE_EPSILON = 1e-3;

    let isDetectionExtractPanelCollapsed = true;
    let detectionExtractImageCache = null;
    let detectionOverlayContext = null;
    let detectionResultViewMode = DETECTION_VIEW_MODE_FINAL;
    let extractFireLineSource = EXTRACT_FIRE_LINE_SOURCE_FINAL;
    let extractFireSymbolSource = EXTRACT_FIRE_SYMBOL_SOURCE_PANEL;
    let extractFireStagePageKey = '';
    let extractFireLastManualAnnotationSignature = '';
    let extractFireLastSymbolAnnotationSignature = '';
    const extractFireOverlayVisibility = {
        line: true,
        text: true,
        symbol: true,
        merge: true
    };
    const extractFireStageJobs = {
        [EXTRACT_FIRE_STAGE_LINE]: { running: false, requestId: 0, controller: null, pageKey: '' },
        [EXTRACT_FIRE_STAGE_TEXT]: { running: false, requestId: 0, controller: null, pageKey: '' },
        [EXTRACT_FIRE_STAGE_SYMBOL]: { running: false, requestId: 0, controller: null, pageKey: '' },
        [EXTRACT_FIRE_STAGE_MERGE]: { running: false, requestId: 0, controller: null, pageKey: '' }
    };

    function extractFireGetStageJob(stageKey) {
        return extractFireStageJobs[stageKey] || null;
    }

    function extractFireIsStageRunning(stageKey) {
        return Boolean(extractFireGetStageJob(stageKey)?.running);
    }

    function extractFireHasAnyRunningJobs() {
        return Object.keys(extractFireStageJobs).some(stageKey => extractFireIsStageRunning(stageKey));
    }

    function extractFireListRunningStageKeys() {
        return Object.keys(extractFireStageJobs).filter(stageKey => extractFireIsStageRunning(stageKey));
    }

    function extractFireCreateAbortError(stageKey, reason = 'cancelled') {
        let error = null;
        if (typeof DOMException === 'function') {
            error = new DOMException(String(reason || 'cancelled'), 'AbortError');
        } else {
            error = new Error(String(reason || 'cancelled'));
            error.name = 'AbortError';
        }
        error.stageKey = stageKey;
        error.cancelReason = reason;
        return error;
    }

    function extractFireIsAbortError(error) {
        return error?.name === 'AbortError'
            || error?.code === 20
            || /abort|cancel/i.test(String(error?.message || error?.cancelReason || ''));
    }

    function extractFireStartStageJob(stageKey) {
        const stageJob = extractFireGetStageJob(stageKey);
        if (!stageJob) {
            throw new Error(`Unknown Extract_FIRE stage: ${stageKey}`);
        }
        stageJob.requestId += 1;
        stageJob.running = true;
        stageJob.controller = typeof AbortController === 'function' ? new AbortController() : null;
        stageJob.pageKey = extractFireGetPageKey();
        updateDetectionExtractUI();
        return {
            requestId: stageJob.requestId,
            signal: stageJob.controller?.signal || null,
            pageKey: stageJob.pageKey
        };
    }

    function extractFireFinishStageJob(stageKey, requestId) {
        const stageJob = extractFireGetStageJob(stageKey);
        if (!stageJob || stageJob.requestId !== requestId) {
            return false;
        }
        stageJob.running = false;
        stageJob.controller = null;
        stageJob.pageKey = '';
        updateDetectionExtractUI();
        return true;
    }

    function extractFireAssertStageJobCurrent(stageKey, requestId, pageKey = extractFireGetPageKey()) {
        const stageJob = extractFireGetStageJob(stageKey);
        const isCurrentRequest = Boolean(stageJob)
            && stageJob.running
            && stageJob.requestId === requestId
            && (!stageJob.pageKey || !pageKey || stageJob.pageKey === pageKey);
        if (!isCurrentRequest) {
            throw extractFireCreateAbortError(stageKey, 'stale');
        }
    }

    function extractFireCancelStageJob(stageKey, reason = 'cancelled', options = {}) {
        const stageJob = extractFireGetStageJob(stageKey);
        if (!stageJob || (!stageJob.running && !stageJob.controller)) {
            return false;
        }
        const controller = stageJob.controller;
        stageJob.requestId += 1;
        stageJob.running = false;
        stageJob.controller = null;
        stageJob.pageKey = '';
        if (controller && typeof controller.abort === 'function') {
            try {
                controller.abort(reason);
            } catch (error) {}
        }
        if (options.updateUi !== false) {
            updateDetectionExtractUI();
        }
        return true;
    }

    function cancelDetectionExtractJobs(options = {}) {
        const reason = String(options.reason || 'cancelled');
        const cancelledStages = extractFireListRunningStageKeys().filter(stageKey => extractFireCancelStageJob(stageKey, reason, { updateUi: false }));
        if (cancelledStages.length && options.keepStatus !== true) {
            setDetectionExtractStatus(`Da huy ${cancelledStages.join(', ')}.`, 'info');
        }
        updateDetectionExtractUI();
        return cancelledStages;
    }

    function detectionClone(value) {
        if (typeof structuredClone === 'function') {
            try {
                return structuredClone(value);
            } catch (error) {}
        }
        return JSON.parse(JSON.stringify(value));
    }

    function detectionSafeNumber(value) {
        const resolvedValue = Number(value);
        return Number.isFinite(resolvedValue) ? resolvedValue : null;
    }

    function detectionRound(value, digits = 3) {
        const factor = 10 ** digits;
        return Math.round(Number(value) * factor) / factor;
    }

    function detectionNormalizeClassName(value) {
        const className = String(value || 'unknown').trim();
        return className || 'unknown';
    }

    function detectionBoundsKey(bounds) {
        if (!bounds) return 'none';
        return [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY]
            .map(value => detectionRound(value, 4))
            .join(',');
    }

    function detectionBuildImageCacheKey(bounds, scale) {
        const sourceName = (currentPdfFile && `${currentPdfFile.name}:${currentPdfFile.size}:${currentPdfFile.lastModified}`)
            || (currentJsonSourceFile && (currentJsonSourceFile.name || String(currentJsonSourceFile)))
            || 'unknown-source';
        const visibleLayers = sortedLayerKeys
            .filter(layerName => layerVisibility[layerName] && !detectionLayerNames.includes(layerName))
            .sort()
            .join('|');
        return [
            sourceName,
            currentPageNum || 1,
            currentLayerField || 'layer',
            detectionBoundsKey(bounds),
            detectionRound(scale, 4),
            visibleLayers,
            layerVisibility?.svg_text !== false ? 'text:1' : 'text:0',
            layerVisibility?.svg_graphic !== false ? 'graphic:1' : 'graphic:0'
        ].join('::');
    }

    function detectionInvalidateExtractImageCache() {
        detectionExtractImageCache = null;
    }

    function extractFireNormalizeDocumentName(name) {
        const rawName = String(name || '').trim();
        if (!rawName) return '';
        const normalizedPath = rawName.replace(/\\/g, '/').split('?')[0].split('#')[0];
        return String(normalizedPath.split('/').pop() || rawName).trim();
    }

    function extractFireGetDocumentKey() {
        const source = currentPdfFile || currentJsonSourceFile || null;
        const sourceName = extractFireNormalizeDocumentName(
            (currentPdfFile && currentPdfFile.name)
            || (currentJsonSourceFile && (currentJsonSourceFile.name || currentJsonSourceFile))
            || ''
        );
        if (!sourceName) return '';
        if (source && typeof source === 'object') {
            const size = Number.isFinite(Number(source.size)) ? Number(source.size) : 0;
            const lastModified = Number.isFinite(Number(source.lastModified)) ? Number(source.lastModified) : 0;
            return `${sourceName}::${size}::${lastModified}`;
        }
        return sourceName;
    }

    function extractFireGetPageKey(pageNum = currentPageNum) {
        const documentKey = extractFireGetDocumentKey();
        const resolvedPageNum = Number(pageNum);
        if (!documentKey || !Number.isFinite(resolvedPageNum) || resolvedPageNum < 1) {
            return '';
        }
        return `${documentKey}::${resolvedPageNum}`;
    }

    function extractFireBindStageResultsToCurrentPage() {
        extractFireStagePageKey = extractFireGetPageKey();
        return extractFireStagePageKey;
    }

    function detectionIsConnectClass(value) {
        return detectionNormalizeClassName(value).toLowerCase() === 'connect';
    }

    function detectionIsJunctionClass(value) {
        const className = detectionNormalizeClassName(value).toLowerCase();
        return className === 'junction'
            || className === 'tee'
            || className === 'elbow'
            || className === 'node'
            || className === 'cross'
            || className === 'intersection';
    }

    function detectionGetClassColor(className) {
        return DETECTION_CLASS_COLORS[detectionNormalizeClassName(className).toLowerCase()] || DETECTION_CLASS_COLORS.default;
    }

    function detectionGetConfidenceDisplayThreshold() {
        const threshold = Number(CONFIG.CONFIDENCE_DISPLAY_THRESHOLD);
        return Number.isFinite(threshold) ? Math.max(0, threshold) : 0;
    }

    function detectionFormatConfidenceLabel(confidence) {
        const normalizedConfidence = detectionSafeNumber(confidence);
        if (normalizedConfidence === null) return '';
        return `${(normalizedConfidence * 100).toFixed(normalizedConfidence >= 0.995 ? 2 : 1)}%`;
    }

    function detectionBuildOverlayRenderContext(detectionJson) {
        const bounds = detectionOverlayContext?.bounds;
        if (!bounds || !Number.isFinite(bounds.width) || bounds.width <= 0 || !Number.isFinite(bounds.height) || bounds.height <= 0) {
            return null;
        }

        const imageSize = detectionJson?.image_size || {};
        const imageWidth = Number(imageSize.width || detectionOverlayContext.imageWidth);
        const imageHeight = Number(imageSize.height || detectionOverlayContext.imageHeight);
        if (!Number.isFinite(imageWidth) || imageWidth <= 0 || !Number.isFinite(imageHeight) || imageHeight <= 0) {
            return null;
        }

        return {
            ...detectionOverlayContext,
            imageWidth,
            imageHeight,
            scaleX: imageWidth / bounds.width,
            scaleY: imageHeight / bounds.height
        };
    }

    function extractFireBuildBackendOverlayContext(result) {
        const backendContext = result?.context || {};
        const rawBounds = backendContext.render_bounds || backendContext.renderBounds || null;
        const normalizedBounds = extractFireNormalizeBBox(rawBounds)
            || (allShapesBounds
                ? {
                    minX: Number(allShapesBounds.minX),
                    minY: Number(allShapesBounds.minY),
                    maxX: Number(allShapesBounds.maxX),
                    maxY: Number(allShapesBounds.maxY)
                }
                : null);
        if (!normalizedBounds) return null;

        const bounds = {
            minX: Number(normalizedBounds.minX),
            minY: Number(normalizedBounds.minY),
            maxX: Number(normalizedBounds.maxX),
            maxY: Number(normalizedBounds.maxY)
        };
        bounds.width = detectionSafeNumber(rawBounds?.width) ?? Math.max(1, bounds.maxX - bounds.minX);
        bounds.height = detectionSafeNumber(rawBounds?.height) ?? Math.max(1, bounds.maxY - bounds.minY);

        const fallbackImageSize = result?.raw?.image_size || result?.processed?.image_size || result?.image_size || {};
        const renderScale = detectionSafeNumber(backendContext.render_scale ?? backendContext.renderScale);
        const imageWidth = detectionSafeNumber(
            backendContext.rendered_image_width
            ?? backendContext.renderedImageWidth
            ?? backendContext.image_width
            ?? backendContext.imageWidth
            ?? fallbackImageSize.width
        ) ?? (renderScale !== null ? Math.max(1, Math.round(bounds.width * renderScale)) : null);
        const imageHeight = detectionSafeNumber(
            backendContext.rendered_image_height
            ?? backendContext.renderedImageHeight
            ?? backendContext.image_height
            ?? backendContext.imageHeight
            ?? fallbackImageSize.height
        ) ?? (renderScale !== null ? Math.max(1, Math.round(bounds.height * renderScale)) : null);

        if (!Number.isFinite(imageWidth) || imageWidth <= 0 || !Number.isFinite(imageHeight) || imageHeight <= 0) {
            return null;
        }

        return {
            bounds,
            imageWidth,
            imageHeight,
            renderScale
        };
    }

    function setDetectionExtractStatus(message, tone = 'info') {
        if (!detectExtractStatus) return;
        detectExtractStatus.classList.remove('is-error', 'is-success');
        if (tone === 'error') {
            detectExtractStatus.classList.add('is-error');
        } else if (tone === 'success') {
            detectExtractStatus.classList.add('is-success');
        }
        detectExtractStatus.textContent = message;
    }

    function detectionGetRawResultCount() {
        return Array.isArray(detectionRawResults?.detections)
            ? detectionRawResults.detections.length
            : 0;
    }

    function detectionGetProcessedResultCount() {
        return Array.isArray(detectionAdjustedResults?.detections)
            ? detectionAdjustedResults.detections.length
            : 0;
    }

    function detectionGetFinalResultCount() {
        return extractFireGetSharedFinalAnnotations().length;
    }

    function detectionIsCompactLineResult(result) {
        return Boolean(result && typeof result === 'object' && Array.isArray(result.detections) && !result.raw && !result.processed && !result.auto_accept);
    }

    function detectionNormalizeLinePoint(point, fallbackLayerName = '') {
        if (!point || typeof point !== 'object') return null;
        const pointX = detectionSafeNumber(point.x ?? point[0]);
        const pointY = detectionSafeNumber(point.y ?? point[1]);
        if (pointX === null || pointY === null) return null;
        return {
            x: detectionRound(pointX, 6),
            y: detectionRound(pointY, 6),
            layerName: String(point.layerName || point.layer_name || fallbackLayerName || '').trim()
        };
    }

    function detectionLineDetectionToAnnotation(detection, index = 0) {
        if (!detection || typeof detection !== 'object') return null;
        const rawType = String(detection.type || detection.class_name || '').trim().toLowerCase();
        const type = detectionIsJunctionClass(rawType) ? 'junction' : (detectionIsConnectClass(rawType) ? 'connect' : '');
        if (!type) return null;
        const layerName = String(detection.layerName || detection.layer_name || detection.postprocess?.layer_name || '').trim();
        const rawPoints = detection.points || detection.manual_points || detection.postprocess?.manual_points || [];
        const points = (Array.isArray(rawPoints) ? rawPoints : [])
            .map(point => detectionNormalizeLinePoint(point, layerName))
            .filter(Boolean);
        const rawSegments = detection.segments || detection.manual_segments || detection.postprocess?.manual_segments || [];
        const segments = (Array.isArray(rawSegments) ? rawSegments : [])
            .map(segment => (Array.isArray(segment) ? segment : [])
                .map(point => detectionNormalizeLinePoint(point, layerName))
                .filter(Boolean))
            .filter(segment => segment.length >= 2);
        if (type === 'connect' && points.length < 2 && !segments.length) return null;
        if (type === 'junction' && !points.length) return null;
        return {
            id: detection.id ?? `extract-line:${index + 1}`,
            type,
            layerName: layerName || points[0]?.layerName || segments[0]?.[0]?.layerName || '',
            source: detection.source || 'extract_fire_api',
            autoManaged: false,
            points,
            lineKeys: Array.from(new Set((detection.lineKeys || detection.line_keys || detection.postprocess?.matched_line_keys || [])
                .map(lineKey => String(lineKey))
                .filter(Boolean))).sort(),
            segments
        };
    }

    function detectionBuildManualAnnotationsFromLineResult(result) {
        if (Array.isArray(result?.manual_annotations)) {
            return detectionClone(result.manual_annotations);
        }
        return (Array.isArray(result?.detections) ? result.detections : [])
            .map((detection, index) => detectionLineDetectionToAnnotation(detection, index))
            .filter(Boolean);
    }

    function detectionAnnotationToLineDetection(annotation, index = 0) {
        if (!annotation || typeof annotation !== 'object') return null;
        const type = String(annotation.type || '').trim().toLowerCase();
        if (type !== 'connect' && type !== 'junction') return null;
        const layerName = String(annotation.layerName || annotation.layer_name || '').trim();
        const points = (Array.isArray(annotation.points) ? annotation.points : [])
            .map(point => detectionNormalizeLinePoint(point, layerName))
            .filter(Boolean);
        const segments = (Array.isArray(annotation.segments) ? annotation.segments : [])
            .map(segment => (Array.isArray(segment) ? segment : [])
                .map(point => detectionNormalizeLinePoint(point, layerName))
                .filter(Boolean))
            .filter(segment => segment.length >= 2);
        if (type === 'connect' && points.length < 2 && !segments.length) return null;
        if (type === 'junction' && !points.length) return null;
        return {
            id: annotation.id ?? `manual-line:${index + 1}`,
            class_name: type,
            layer_name: layerName || points[0]?.layerName || segments[0]?.[0]?.layerName || '',
            source: annotation.source || 'manual',
            points,
            segments,
            line_keys: Array.from(new Set((annotation.lineKeys || annotation.line_keys || [])
                .map(lineKey => String(lineKey))
                .filter(Boolean))).sort()
        };
    }

    function extractFireBuildTextItemsFromResult(textResult) {
        if (!textResult || typeof textResult !== 'object') return [];
        if (Array.isArray(textResult.items)) {
            return textResult.items
                .map((item, index) => ({
                    ...item,
                    id: item?.id || index + 1,
                    text: String(item?.text || ''),
                    bbox: detectionClone(item?.bbox || []),
                    orientation: item?.orientation ?? item?.angle ?? null,
                    seqnos: Array.isArray(item?.seqnos) ? detectionClone(item.seqnos) : (Array.isArray(item?.list_seqno) ? detectionClone(item.list_seqno) : [])
                }))
                .filter(item => item && item.bbox.length >= 4);
        }
        const texts = Array.isArray(textResult.rec_texts) ? textResult.rec_texts : [];
        const boxes = Array.isArray(textResult.rec_boxes) ? textResult.rec_boxes : [];
        const orientations = Array.isArray(textResult.textline_orientation_angles) ? textResult.textline_orientation_angles : [];
        const seqnoLists = Array.isArray(textResult.list_seqno) ? textResult.list_seqno : [];
        return texts
            .map((text, index) => ({
                id: index + 1,
                text: String(text || ''),
                bbox: detectionClone(boxes[index] || []),
                orientation: orientations[index] ?? null,
                seqnos: Array.isArray(seqnoLists[index]) ? detectionClone(seqnoLists[index]) : []
            }))
            .filter(item => item.bbox.length >= 4);
    }

    function extractFireGetTextItems() {
        return extractFireBuildTextItemsFromResult(extractFireTextResults);
    }

    function extractFireSetTextItems(items) {
        if (!extractFireTextResults || typeof extractFireTextResults !== 'object') {
            extractFireTextResults = {};
        }
        const normalizedItems = (Array.isArray(items) ? items : [])
            .map((item, index) => ({
                ...item,
                id: index + 1,
                text: String(item?.text || ''),
                bbox: detectionClone(item?.bbox || []),
                orientation: item?.orientation ?? null,
                seqnos: Array.isArray(item?.seqnos) ? detectionClone(item.seqnos) : []
            }))
            .filter(item => item.bbox.length >= 4);
        delete extractFireTextResults.items;
        extractFireTextResults.rec_texts = normalizedItems.map(item => item.text);
        extractFireTextResults.rec_boxes = normalizedItems.map(item => detectionClone(item.bbox));
        extractFireTextResults.textline_orientation_angles = normalizedItems.map(item => item.orientation ?? null);
        extractFireTextResults.list_seqno = normalizedItems.map(item => detectionClone(item.seqnos));
        if (extractFireTextResults.summary && typeof extractFireTextResults.summary === 'object') {
            extractFireTextResults.summary.text_count = normalizedItems.length;
        }
        if (extractFireTextResults.sources?.merged && typeof extractFireTextResults.sources.merged === 'object') {
            delete extractFireTextResults.sources.merged.items;
            extractFireTextResults.sources.merged.rec_texts = detectionClone(extractFireTextResults.rec_texts);
            extractFireTextResults.sources.merged.rec_boxes = detectionClone(extractFireTextResults.rec_boxes);
            extractFireTextResults.sources.merged.textline_orientation_angles = detectionClone(extractFireTextResults.textline_orientation_angles);
            extractFireTextResults.sources.merged.list_seqno = detectionClone(extractFireTextResults.list_seqno);
        }
    }

    function extractFireGetSymbolItemsFromResult(symbolResult) {
        const rawItems = Array.isArray(symbolResult)
            ? symbolResult
            : (Array.isArray(symbolResult?.items) ? symbolResult.items : []);
        return rawItems
            .map((item, index) => {
                const bbox = extractFireNormalizeBBox(item?.bbox || item?.world_bbox || item?.worldBBox || item?.rect);
                if (!bbox) return null;
                const labelName = String(item?.shape_name || item?.label_name || item?.labelName || 'Sprinkler').trim() || 'Sprinkler';
                return {
                    ...item,
                    id: item?.id || item?.annotation_id || `symbol:${index + 1}`,
                    shape_name: labelName,
                    label_name: labelName,
                    source: item?.source || item?.method || 'extract_fire_api',
                    bbox: [bbox.minX, bbox.minY, bbox.maxX, bbox.maxY]
                };
            })
            .filter(Boolean);
    }

    function extractFireGetTextCount() {
        return extractFireGetTextItems().length;
    }

    function extractFireGetSymbolCount() {
        return extractFireGetSymbolItemsFromResult(extractFireSymbolResults).length;
    }

    function extractFireGetMergedCount() {
        return Array.isArray(extractFireMergeResults?.json_objects) ? extractFireMergeResults.json_objects.length : 0;
    }

    function extractFireGetPanelLineCount() {
        return getExtractFireManualAnnotationPayload().length;
    }

    function extractFireGetPanelSymbolCount() {
        return getExtractFireSymbolAnnotationsPayload().length;
    }

    function setExtractFireToggleButton(button, active, disabled = false) {
        if (!button) return;
        button.classList.toggle('is-active', Boolean(active));
        button.setAttribute('aria-pressed', String(Boolean(active)));
        button.disabled = Boolean(disabled);
    }

    function setExtractFireLoadingButton(button, isLoading) {
        if (!button) return;
        const nextLoading = Boolean(isLoading);
        button.classList.toggle('is-loading', nextLoading);
        button.setAttribute('aria-busy', String(nextLoading));
        const stageElement = button.closest('.detect-extract-stage');
        if (stageElement) {
            stageElement.classList.toggle('is-loading', nextLoading);
        }
    }

    function setExtractFireLoadingBadge(badge, isLoading) {
        if (!badge) return;
        badge.classList.toggle('is-loading', Boolean(isLoading));
    }

    function extractFireBatchSetOverlayVisibility(nextVisibility, options = {}) {
        let didChange = false;
        Object.entries(nextVisibility || {}).forEach(([key, value]) => {
            if (!Object.prototype.hasOwnProperty.call(extractFireOverlayVisibility, key)) return;
            const nextValue = Boolean(value);
            if (extractFireOverlayVisibility[key] === nextValue) return;
            extractFireOverlayVisibility[key] = nextValue;
            didChange = true;
        });
        if (!didChange) return false;
        if (options.refreshUi !== false) {
            updateDetectionExtractUI();
        }
        if (options.redraw !== false && typeof scheduleDraw === 'function') {
            scheduleDraw();
        }
        return true;
    }

    function extractFireHandleLineOverlayDisabled() {
        const isAnnotationEditingActive = typeof annotationMode !== 'undefined' && Boolean(annotationMode);
        if (isAnnotationEditingActive && typeof deactivateManualLabelMode === 'function') {
            deactivateManualLabelMode();
        }
    }

    function extractFireHandleSymbolOverlayDisabled() {
        if (typeof deactivateSymbolFindArming === 'function') {
            deactivateSymbolFindArming();
        }
        if (typeof deactivateSymbolDeleteArming === 'function') {
            deactivateSymbolDeleteArming();
        }
    }

    function extractFireHandleLinkedPanelForOverlay(key, isVisible) {
        if (key === 'line' && typeof applyManualLabelPanelState === 'function' && typeof isManualLabelPanelCollapsed !== 'undefined') {
            const shouldCollapse = !Boolean(isVisible);
            if (isManualLabelPanelCollapsed !== shouldCollapse) {
                applyManualLabelPanelState(shouldCollapse);
            }
        }
        if (key === 'symbol' && typeof applySymbolAnnotationPanelState === 'function' && typeof isSymbolAnnotationPanelCollapsed !== 'undefined') {
            const shouldCollapse = !Boolean(isVisible);
            if (isSymbolAnnotationPanelCollapsed !== shouldCollapse) {
                applySymbolAnnotationPanelState(shouldCollapse);
            }
        }
    }

    function handleExtractLinePanelStateChange(collapsed) {
        if (collapsed) {
            if (!extractFireOverlayVisibility.line) return;
            extractFireOverlayVisibility.line = false;
            extractFireHandleLineOverlayDisabled();
        } else if (!extractFireOverlayVisibility.line) {
            extractFireOverlayVisibility.line = true;
        } else {
            return;
        }
        updateDetectionExtractUI();
        if (typeof scheduleDraw === 'function') {
            scheduleDraw();
        }
    }

    function handleExtractSymbolPanelStateChange(collapsed) {
        if (collapsed) {
            if (!extractFireOverlayVisibility.symbol) return;
            extractFireOverlayVisibility.symbol = false;
            extractFireHandleSymbolOverlayDisabled();
        } else if (!extractFireOverlayVisibility.symbol) {
            extractFireOverlayVisibility.symbol = true;
        } else {
            return;
        }
        updateDetectionExtractUI();
        if (typeof scheduleDraw === 'function') {
            scheduleDraw();
        }
    }

    function extractFireHasSelectedLineData() {
        return extractFireLineSource === EXTRACT_FIRE_LINE_SOURCE_PANEL
            ? extractFireGetPanelLineCount() > 0
            : detectionGetFinalResultCount() > 0;
    }

    function detectionGetResultCountForViewMode(viewMode = detectionResultViewMode) {
        if (viewMode === DETECTION_VIEW_MODE_RAW) {
            return detectionGetRawResultCount();
        }
        if (viewMode === DETECTION_VIEW_MODE_FINAL) {
            return detectionGetFinalResultCount();
        }
        return detectionGetProcessedResultCount();
    }

    function detectionGetResultForViewMode(viewMode = detectionResultViewMode) {
        if (viewMode === DETECTION_VIEW_MODE_RAW) {
            return detectionRawResults;
        }
        if (viewMode === DETECTION_VIEW_MODE_FINAL) {
            const finalAnnotations = extractFireGetSharedFinalAnnotations();
            if (finalAnnotations.length || detectionAutoAcceptResults) {
                return {
                    ...(detectionAutoAcceptResults || {}),
                    manual_annotations: finalAnnotations
                };
            }
            return detectionAutoAcceptResults;
        }
        return detectionAdjustedResults;
    }

    function detectionEnsureAvailableViewMode() {
        const availableModes = [
            detectionGetFinalResultCount() > 0 ? DETECTION_VIEW_MODE_FINAL : null,
            detectionGetProcessedResultCount() > 0 ? DETECTION_VIEW_MODE_PROCESSED : null,
            detectionGetRawResultCount() > 0 ? DETECTION_VIEW_MODE_RAW : null
        ].filter(Boolean);
        if (!availableModes.length) {
            detectionResultViewMode = DETECTION_VIEW_MODE_FINAL;
            return;
        }
        if (!availableModes.includes(detectionResultViewMode)) {
            detectionResultViewMode = availableModes[0];
        }
    }

    function detectionFormatCoverageThreshold() {
        return `${Math.round(DETECTION_CONNECT_VERIFY_MIN_COVERAGE_RATIO * 100)}%`;
    }

    function updateDetectionExtractSummary() {
        if (!detectExtractSummary) return;
        const runningStages = extractFireListRunningStageKeys();
        const runningSuffix = runningStages.length ? ` | Running ${runningStages.join(', ')}` : '';
        detectExtractSummary.textContent = `Line ${detectionGetFinalResultCount()} | Text ${extractFireGetTextCount()} | Symbol ${extractFireGetPanelSymbolCount() || extractFireGetSymbolCount()} | Merge ${extractFireGetMergedCount()} | Verify >= ${detectionFormatCoverageThreshold()}${runningSuffix}`;
    }

    function refreshDetectionVisualizationForCurrentView() {
        const activeResult = detectionGetResultForViewMode();
        if (!activeResult || !detectionOverlayContext) return false;
        if (Array.isArray(detectionLayerNames) && detectionLayerNames.length) {
            clearDetectionVisualization({ refresh: false, preserveResults: true });
        }
        scheduleDraw();
        return true;
    }

    function setDetectionResultViewMode(nextMode, options = {}) {
        if (nextMode !== DETECTION_VIEW_MODE_RAW && nextMode !== DETECTION_VIEW_MODE_PROCESSED && nextMode !== DETECTION_VIEW_MODE_FINAL) {
            return;
        }
        detectionResultViewMode = nextMode;
        detectionEnsureAvailableViewMode();
        if (detectionResultViewMode !== DETECTION_VIEW_MODE_FINAL && typeof deactivateManualLabelMode === 'function' && annotationMode) {
            deactivateManualLabelMode();
        }
        if (options.refreshVisualization !== false) {
            refreshDetectionVisualizationForCurrentView();
        }
        updateDetectionExtractUI();
    }

    function updateDetectionExtractUI() {
        detectionEnsureAvailableViewMode();
        const detectionCount = detectionGetResultCountForViewMode();
        const rawCount = detectionGetRawResultCount();
        const processedCount = detectionGetProcessedResultCount();
        const finalCount = detectionGetFinalResultCount();
        const textCount = extractFireGetTextCount();
        const symbolCount = extractFireGetSymbolCount();
        const mergeCount = extractFireGetMergedCount();
        const panelLineCount = extractFireGetPanelLineCount();
        const panelSymbolCount = extractFireGetPanelSymbolCount();
        if (detectExtractCountBadge) {
            detectExtractCountBadge.textContent = String(detectionCount);
        }
        if (detectExtractPanel) {
            detectExtractPanel.classList.toggle('has-running-jobs', extractFireHasAnyRunningJobs());
        }
        setExtractFireLoadingBadge(detectExtractCountBadge, extractFireHasAnyRunningJobs());
        if (extractLineStageCount) {
            extractLineStageCount.textContent = String(finalCount || processedCount || rawCount);
            extractLineStageCount.title = `Final ${finalCount}, labels ${panelLineCount}`;
        }
        if (extractTextStageCount) {
            extractTextStageCount.textContent = String(textCount);
        }
        if (extractSymbolStageCount) {
            extractSymbolStageCount.textContent = String(panelSymbolCount || symbolCount);
            extractSymbolStageCount.title = `API ${symbolCount}, labels ${panelSymbolCount}`;
        }
        if (extractMergeStageCount) {
            extractMergeStageCount.textContent = String(mergeCount);
        }
        updateDetectionExtractSummary();
        if (btnDetectViewProcessed) {
            const isActive = detectionResultViewMode === DETECTION_VIEW_MODE_PROCESSED;
            btnDetectViewProcessed.classList.toggle('is-active', isActive);
            btnDetectViewProcessed.setAttribute('aria-pressed', String(isActive));
            btnDetectViewProcessed.disabled = processedCount === 0;
        }
        if (btnDetectViewRaw) {
            const isActive = detectionResultViewMode === DETECTION_VIEW_MODE_RAW;
            btnDetectViewRaw.classList.toggle('is-active', isActive);
            btnDetectViewRaw.setAttribute('aria-pressed', String(isActive));
            btnDetectViewRaw.disabled = rawCount === 0;
        }
        if (btnDetectViewFinal) {
            const isActive = detectionResultViewMode === DETECTION_VIEW_MODE_FINAL;
            btnDetectViewFinal.classList.toggle('is-active', isActive);
            btnDetectViewFinal.setAttribute('aria-pressed', String(isActive));
            btnDetectViewFinal.disabled = finalCount === 0;
        }
        setExtractFireToggleButton(btnExtractOverlayLine, extractFireOverlayVisibility.line, !rawCount && !processedCount && !finalCount && !panelLineCount);
        setExtractFireToggleButton(btnExtractOverlayText, extractFireOverlayVisibility.text, textCount === 0);
        setExtractFireToggleButton(btnExtractOverlaySymbol, extractFireOverlayVisibility.symbol, !symbolCount && !panelSymbolCount);
        setExtractFireToggleButton(btnExtractOverlayMerge, extractFireOverlayVisibility.merge, mergeCount === 0);
        setExtractFireToggleButton(btnExtractLineSourceFinal, extractFireLineSource === EXTRACT_FIRE_LINE_SOURCE_FINAL, finalCount === 0);
        setExtractFireToggleButton(btnExtractLineSourcePanel, extractFireLineSource === EXTRACT_FIRE_LINE_SOURCE_PANEL, panelLineCount === 0);
        setExtractFireToggleButton(btnExtractSymbolSourcePanel, extractFireSymbolSource === EXTRACT_FIRE_SYMBOL_SOURCE_PANEL, panelSymbolCount === 0);
        setExtractFireToggleButton(btnExtractSymbolSourceApi, extractFireSymbolSource === EXTRACT_FIRE_SYMBOL_SOURCE_API, symbolCount === 0);
        setExtractFireToggleButton(btnExtractSymbolSourceBoth, extractFireSymbolSource === EXTRACT_FIRE_SYMBOL_SOURCE_BOTH, !symbolCount && !panelSymbolCount);
        if (btnRunDetectExtract) {
            btnRunDetectExtract.disabled = !hasRenderableDocument();
            btnRunDetectExtract.textContent = extractFireIsStageRunning(EXTRACT_FIRE_STAGE_LINE) ? 'Cancel Line' : 'Extract Line';
            setExtractFireLoadingButton(btnRunDetectExtract, extractFireIsStageRunning(EXTRACT_FIRE_STAGE_LINE));
        }
        if (btnPromoteExtractLineToLabels) {
            btnPromoteExtractLineToLabels.disabled = finalCount === 0;
        }
        if (btnRunExtractFireText) {
            btnRunExtractFireText.disabled = !hasRenderableDocument();
            btnRunExtractFireText.textContent = extractFireIsStageRunning(EXTRACT_FIRE_STAGE_TEXT) ? 'Cancel Text' : 'Extract Text';
            setExtractFireLoadingButton(btnRunExtractFireText, extractFireIsStageRunning(EXTRACT_FIRE_STAGE_TEXT));
        }
        if (btnRunExtractFireSymbol) {
            btnRunExtractFireSymbol.disabled = !hasRenderableDocument();
            btnRunExtractFireSymbol.textContent = extractFireIsStageRunning(EXTRACT_FIRE_STAGE_SYMBOL) ? 'Cancel Symbol' : 'Extract Symbol';
            setExtractFireLoadingButton(btnRunExtractFireSymbol, extractFireIsStageRunning(EXTRACT_FIRE_STAGE_SYMBOL));
        }
        if (btnRunExtractFireMerge) {
            btnRunExtractFireMerge.disabled = !extractFireIsStageRunning(EXTRACT_FIRE_STAGE_MERGE) && !extractFireHasSelectedLineData();
            btnRunExtractFireMerge.textContent = extractFireIsStageRunning(EXTRACT_FIRE_STAGE_MERGE) ? 'Cancel Merge' : 'Merge';
            setExtractFireLoadingButton(btnRunExtractFireMerge, extractFireIsStageRunning(EXTRACT_FIRE_STAGE_MERGE));
        }
        if (btnExportExtractFireJson) {
            btnExportExtractFireJson.disabled = !mergeCount;
        }
        if (btnClearDetectExtract) {
            btnClearDetectExtract.disabled = !extractFireHasAnyRunningJobs() && !rawCount && !processedCount && !finalCount && !textCount && !symbolCount && !mergeCount;
            btnClearDetectExtract.textContent = extractFireHasAnyRunningJobs() ? 'Cancel + Clear' : 'Clear';
        }
        if (!rawCount && !processedCount && !finalCount && !textCount && !symbolCount && !mergeCount && detectExtractStatus && !extractFireHasAnyRunningJobs()) {
            setDetectionExtractStatus('No detection results yet.');
        }
    }

    function applyDetectionExtractPanelState(collapsed) {
        isDetectionExtractPanelCollapsed = collapsed;
        if (detectExtractPanel) {
            detectExtractPanel.classList.toggle('is-collapsed', collapsed);
        }
        if (btnToggleDetectExtractPanel) {
            btnToggleDetectExtractPanel.setAttribute('aria-expanded', String(!collapsed));
            btnToggleDetectExtractPanel.title = collapsed ? 'Expand' : 'Collapse';
        }
        try {
            localStorage.setItem(DETECTION_PANEL_STORAGE_KEY, collapsed ? '1' : '0');
        } catch (error) {}
        if (collapsed) {
            extractFireBatchSetOverlayVisibility({
                line: false,
                text: false,
                symbol: false,
                merge: false
            }, {
                refreshUi: false,
                redraw: false
            });
            extractFireHandleLineOverlayDisabled();
            extractFireHandleSymbolOverlayDisabled();
        }
        updateDetectionExtractUI();
        if (typeof scheduleDraw === 'function') {
            scheduleDraw();
        }
    }

    function detectionRecomputeAllShapeBounds() {
        allShapesBounds = null;
        _perLayerBounds = {};
        allShapesSorted.forEach(shape => {
            if (!shape) return;
            if (!shape.bbox && typeof computeShapeBbox === 'function') {
                computeShapeBbox(shape);
            }
            const shapeBounds = getBoundsFromBbox(shape.bbox);
            allShapesBounds = mergeBounds(allShapesBounds, shapeBounds);
            if (shape.layer) {
                _perLayerBounds[shape.layer] = mergeBounds(_perLayerBounds[shape.layer], shapeBounds);
            }
        });
    }

    function clearDetectionVisualization(options = {}) {
        const previousLayerNames = new Set(Array.isArray(detectionLayerNames) ? detectionLayerNames : []);
        if (previousLayerNames.size) {
            previousLayerNames.forEach(layerName => {
                delete layerIndex[layerName];
                delete layerVisibility[layerName];
                delete totalCommands[layerName];
            });
            sortedLayerKeys = sortedLayerKeys.filter(layerName => !previousLayerNames.has(layerName));
            allShapesSorted = allShapesSorted.filter(shape => !previousLayerNames.has(shape?.layer));
            detectionRecomputeAllShapeBounds();
        }

        detectionLayerNames = [];
        if (!options.preserveResults) {
            detectionRawResults = null;
            detectionAdjustedResults = null;
            detectionAutoAcceptResults = null;
            extractFireLineResults = null;
            detectionOverlayContext = null;
            if (options.clearStageResults !== false) {
                extractFireTextResults = null;
                extractFireSymbolResults = null;
                extractFireMergeResults = null;
                extractFireBindStageResultsToCurrentPage();
            } else {
                extractFireMergeResults = null;
            }
        }

        if (options.refresh !== false) {
            if (typeof rebuildQuadtree === 'function') {
                rebuildQuadtree();
            }
            if (typeof invalidateShapeRasterCache === 'function') {
                invalidateShapeRasterCache();
                scheduleShapeRasterCacheBuild();
            }
            if (typeof invalidateSeqnoHoverIndex === 'function') {
                invalidateSeqnoHoverIndex();
            }
            if (typeof invalidateSnapPointIndex === 'function') {
                invalidateSnapPointIndex();
            }
            updateLayerList();
            scheduleDraw();
        }
        updateDetectionExtractUI();
    }

    function detectionBoundsFromPointPairs(points) {
        if (!Array.isArray(points) || !points.length) return null;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        points.forEach(point => {
            const pointX = detectionSafeNumber(point?.[0] ?? point?.x);
            const pointY = detectionSafeNumber(point?.[1] ?? point?.y);
            if (pointX === null || pointY === null) return;
            minX = Math.min(minX, pointX);
            minY = Math.min(minY, pointY);
            maxX = Math.max(maxX, pointX);
            maxY = Math.max(maxY, pointY);
        });
        if (minX === Infinity) return null;
        return {
            minX,
            minY,
            maxX,
            maxY,
            width: maxX - minX,
            height: maxY - minY,
            center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
        };
    }

    function detectionBoundsFromAabb(values) {
        if (!Array.isArray(values) || values.length < 4) return null;
        const minX = detectionSafeNumber(values[0]);
        const minY = detectionSafeNumber(values[1]);
        const maxX = detectionSafeNumber(values[2]);
        const maxY = detectionSafeNumber(values[3]);
        if ([minX, minY, maxX, maxY].some(value => value === null)) return null;
        return {
            minX,
            minY,
            maxX,
            maxY,
            width: maxX - minX,
            height: maxY - minY,
            center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
        };
    }

    function detectionBoundsToAabb(bounds) {
        return [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY];
    }

    function detectionExpandBounds(bounds, paddingX, paddingY = paddingX) {
        return {
            minX: bounds.minX - paddingX,
            minY: bounds.minY - paddingY,
            maxX: bounds.maxX + paddingX,
            maxY: bounds.maxY + paddingY,
            width: bounds.width + (paddingX * 2),
            height: bounds.height + (paddingY * 2),
            center: bounds.center
        };
    }

    function detectionDoBoundsIntersect(boundsA, boundsB) {
        return Boolean(boundsA && boundsB) && !(
            boundsA.maxX < boundsB.minX
            || boundsA.minX > boundsB.maxX
            || boundsA.maxY < boundsB.minY
            || boundsA.minY > boundsB.maxY
        );
    }

    function detectionDistance(pointA, pointB) {
        return Math.hypot(Number(pointB.x) - Number(pointA.x), Number(pointB.y) - Number(pointA.y));
    }

    function detectionMidpoint(pointA, pointB) {
        return { x: (Number(pointA.x) + Number(pointB.x)) / 2, y: (Number(pointA.y) + Number(pointB.y)) / 2 };
    }

    function detectionPointDistanceToSegment(point, segmentStart, segmentEnd) {
        const dx = Number(segmentEnd.x) - Number(segmentStart.x);
        const dy = Number(segmentEnd.y) - Number(segmentStart.y);
        const segmentLengthSquared = (dx * dx) + (dy * dy);
        if (segmentLengthSquared <= 1e-12) {
            return detectionDistance(point, segmentStart);
        }
        const projection = ((Number(point.x) - Number(segmentStart.x)) * dx) + ((Number(point.y) - Number(segmentStart.y)) * dy);
        const t = Math.max(0, Math.min(1, projection / segmentLengthSquared));
        return detectionDistance(point, {
            x: Number(segmentStart.x) + (t * dx),
            y: Number(segmentStart.y) + (t * dy)
        });
    }

    function detectionLineUnitDirection(pointA, pointB) {
        const lineLength = detectionDistance(pointA, pointB);
        if (lineLength <= 1e-6) return null;
        return {
            x: (Number(pointB.x) - Number(pointA.x)) / lineLength,
            y: (Number(pointB.y) - Number(pointA.y)) / lineLength
        };
    }

    function detectionUndirectedAngleDegrees(directionA, directionB) {
        if (!directionA || !directionB) return 90;
        const dotProduct = Math.abs((directionA.x * directionB.x) + (directionA.y * directionB.y));
        const clampedDot = Math.max(-1, Math.min(1, dotProduct));
        return Math.acos(clampedDot) * (180 / Math.PI);
    }

    function detectionProjectPoint(point, origin, direction) {
        return ((Number(point.x) - Number(origin.x)) * direction.x) + ((Number(point.y) - Number(origin.y)) * direction.y);
    }

    function detectionAxisOffset(point, origin, direction) {
        return Math.abs(((Number(point.x) - Number(origin.x)) * (-direction.y)) + ((Number(point.y) - Number(origin.y)) * direction.x));
    }

    function detectionLineProjectionRange(lineCandidate, origin, direction) {
        const valueA = detectionProjectPoint(lineCandidate.pointA, origin, direction);
        const valueB = detectionProjectPoint(lineCandidate.pointB, origin, direction);
        return [Math.min(valueA, valueB), Math.max(valueA, valueB)];
    }

    function detectionLineAxisOffset(lineCandidate, origin, direction) {
        return Math.max(
            detectionAxisOffset(lineCandidate.pointA, origin, direction),
            detectionAxisOffset(lineCandidate.pointB, origin, direction)
        );
    }

    function detectionProjectionGap(rangeA, rangeB) {
        if (rangeA[1] < rangeB[0]) return rangeB[0] - rangeA[1];
        if (rangeB[1] < rangeA[0]) return rangeA[0] - rangeB[1];
        return 0;
    }

    function detectionBoundsIou(boundsA, boundsB) {
        const intersectionMinX = Math.max(boundsA.minX, boundsB.minX);
        const intersectionMinY = Math.max(boundsA.minY, boundsB.minY);
        const intersectionMaxX = Math.min(boundsA.maxX, boundsB.maxX);
        const intersectionMaxY = Math.min(boundsA.maxY, boundsB.maxY);
        const intersectionWidth = Math.max(0, intersectionMaxX - intersectionMinX);
        const intersectionHeight = Math.max(0, intersectionMaxY - intersectionMinY);
        const intersectionArea = intersectionWidth * intersectionHeight;
        if (intersectionArea <= 0) return 0;
        const unionArea = (boundsA.width * boundsA.height) + (boundsB.width * boundsB.height) - intersectionArea;
        return unionArea > 1e-12 ? intersectionArea / unionArea : 0;
    }

    function detectionPixelPointToWorld(point, context) {
        return {
            x: context.bounds.minX + (Number(point.x ?? point[0]) / context.scaleX),
            y: context.bounds.minY + (Number(point.y ?? point[1]) / context.scaleY)
        };
    }

    function detectionWorldPointToPixel(point, context) {
        return [
            (Number(point.x) - context.bounds.minX) * context.scaleX,
            (Number(point.y) - context.bounds.minY) * context.scaleY
        ];
    }

    function detectionCreateLineCandidate(shape, item, layerName) {
        if (!shape || !Array.isArray(item) || item[0] !== 'l') return null;
        const rawPointA = Array.isArray(item[1]) ? item[1] : null;
        const rawPointB = Array.isArray(item[2]) ? item[2] : null;
        if (!rawPointA || !rawPointB || rawPointA.length < 2 || rawPointB.length < 2) return null;

        const pointA = { x: Number(rawPointA[0]), y: Number(rawPointA[1]), layerName };
        const pointB = { x: Number(rawPointB[0]), y: Number(rawPointB[1]), layerName };
        if (![pointA.x, pointA.y, pointB.x, pointB.y].every(Number.isFinite)) return null;
        const bbox = detectionBoundsFromPointPairs([[pointA.x, pointA.y], [pointB.x, pointB.y]]);
        if (!bbox) return null;
        return {
            key: createNormalizedLineKey(layerName, pointA, pointB),
            layerName,
            pointA,
            pointB,
            bbox,
            length: detectionDistance(pointA, pointB)
        };
    }

    function detectionConvertManualLineCandidate(lineCandidate) {
        if (!lineCandidate || !Array.isArray(lineCandidate.points) || lineCandidate.points.length < 2) return null;
        const layerName = lineCandidate.layerName;
        if (!layerName) return null;
        const pointA = {
            x: Number(lineCandidate.points[0].x),
            y: Number(lineCandidate.points[0].y),
            layerName
        };
        const pointB = {
            x: Number(lineCandidate.points[1].x),
            y: Number(lineCandidate.points[1].y),
            layerName
        };
        if (![pointA.x, pointA.y, pointB.x, pointB.y].every(Number.isFinite)) return null;
        const bbox = lineCandidate.bbox || detectionBoundsFromPointPairs([[pointA.x, pointA.y], [pointB.x, pointB.y]]);
        if (!bbox) return null;
        return {
            key: lineCandidate.id || createNormalizedLineKey(layerName, pointA, pointB),
            layerName,
            pointA,
            pointB,
            bbox,
            length: detectionDistance(pointA, pointB)
        };
    }

    function detectionAddUniqueLineCandidate(uniqueLines, lineCandidate) {
        const normalizedLineCandidate = lineCandidate?.pointA
            ? lineCandidate
            : detectionConvertManualLineCandidate(lineCandidate);
        if (!normalizedLineCandidate || uniqueLines.has(normalizedLineCandidate.key)) return;
        uniqueLines.set(normalizedLineCandidate.key, normalizedLineCandidate);
    }

    function detectionBuildVisibleLineCandidates() {
        const visibleLayers = new Set(getVisibleRenderableLayers());
        const uniqueLines = new Map();

        if (typeof queryLayerLineCandidates === 'function') {
            visibleLayers.forEach(layerName => {
                queryLayerLineCandidates(layerName).forEach(lineCandidate => {
                    detectionAddUniqueLineCandidate(uniqueLines, lineCandidate);
                });
            });
            if (uniqueLines.size) {
                return Array.from(uniqueLines.values());
            }
        }

        if (typeof queryLineCandidatesFromSharedShapeCache === 'function') {
            queryLineCandidatesFromSharedShapeCache(null, null).forEach(lineCandidate => {
                if (visibleLayers.has(lineCandidate?.layerName)) {
                    detectionAddUniqueLineCandidate(uniqueLines, lineCandidate);
                }
            });
            if (uniqueLines.size) {
                return Array.from(uniqueLines.values());
            }
        }

        allShapesSorted.forEach(shape => {
            const layerName = shape?.layer || getShapeLayerNameForField(shape, currentLayerField);
            if (!layerName || !visibleLayers.has(layerName) || !Array.isArray(shape?.items)) return;
            shape.items.forEach(item => {
                const lineCandidate = detectionCreateLineCandidate(shape, item, layerName);
                detectionAddUniqueLineCandidate(uniqueLines, lineCandidate);
            });
        });
        return Array.from(uniqueLines.values());
    }

    function detectionBuildLineSpatialIndex(lineCandidates) {
        if (!Array.isArray(lineCandidates) || !lineCandidates.length || typeof Quadtree !== 'function') {
            return {
                query: range => lineCandidates.filter(lineCandidate => detectionDoBoundsIntersect(lineCandidate.bbox, range))
            };
        }

        let indexBounds = null;
        lineCandidates.forEach(lineCandidate => {
            indexBounds = mergeBounds(indexBounds, lineCandidate.bbox);
        });
        if (!indexBounds) {
            return { query: () => [] };
        }

        const quadtree = new Quadtree({
            x: indexBounds.minX - 100,
            y: indexBounds.minY - 100,
            width: indexBounds.width + 200,
            height: indexBounds.height + 200
        }, 64, 14);
        lineCandidates.forEach(lineCandidate => quadtree.insert(lineCandidate));
        return {
            query: range => Array.from(new Set(quadtree.query(range)))
        };
    }

    function detectionResolveQuery(detection, context) {
        const bboxPx = detectionBoundsFromAabb(detection?.aabb || [])
            || detectionBoundsFromPointPairs(detection?.obb || []);
        if (!bboxPx) return null;

        const bboxWorldMin = detectionPixelPointToWorld({ x: bboxPx.minX, y: bboxPx.minY }, context);
        const bboxWorldMax = detectionPixelPointToWorld({ x: bboxPx.maxX, y: bboxPx.maxY }, context);
        const bboxWorld = {
            minX: bboxWorldMin.x,
            minY: bboxWorldMin.y,
            maxX: bboxWorldMax.x,
            maxY: bboxWorldMax.y,
            width: bboxWorldMax.x - bboxWorldMin.x,
            height: bboxWorldMax.y - bboxWorldMin.y,
            center: { x: (bboxWorldMin.x + bboxWorldMax.x) / 2, y: (bboxWorldMin.y + bboxWorldMax.y) / 2 }
        };

        const obbPoints = Array.isArray(detection?.obb)
            ? detection.obb
                .map(point => {
                    if (!Array.isArray(point) || point.length < 2) return null;
                    const pointX = detectionSafeNumber(point[0]);
                    const pointY = detectionSafeNumber(point[1]);
                    return pointX === null || pointY === null ? null : { x: pointX, y: pointY };
                })
                .filter(Boolean)
            : [];

        let axisWorld = null;
        let majorLengthPx = Math.max(bboxPx.width, bboxPx.height);
        let minorLengthPx = Math.min(bboxPx.width, bboxPx.height);
        if (obbPoints.length >= 4) {
            const edgePairs = obbPoints.map((point, index) => [point, obbPoints[(index + 1) % obbPoints.length]]);
            const longestEdge = edgePairs.slice().sort((left, right) => detectionDistance(right[0], right[1]) - detectionDistance(left[0], left[1]))[0];
            const longestEdgeIndex = edgePairs.indexOf(longestEdge);
            const orthogonalEdge = edgePairs[(longestEdgeIndex + 1) % edgePairs.length];
            majorLengthPx = detectionDistance(longestEdge[0], longestEdge[1]);
            minorLengthPx = detectionDistance(orthogonalEdge[0], orthogonalEdge[1]);
            axisWorld = detectionLineUnitDirection(
                detectionPixelPointToWorld(longestEdge[0], context),
                detectionPixelPointToWorld(longestEdge[1], context)
            );
        }

        if (!axisWorld) {
            axisWorld = bboxPx.width >= bboxPx.height ? { x: 1, y: 0 } : { x: 0, y: 1 };
        }

        return {
            bboxPx,
            bboxWorld,
            centerPx: bboxPx.center,
            centerWorld: detectionPixelPointToWorld(bboxPx.center, context),
            axisWorld,
            majorLengthPx,
            minorLengthPx
        };
    }

    function detectionBuildManualConnectWorldPolygon(pointA, pointB, halfSize) {
        const dx = Number(pointB.x) - Number(pointA.x);
        const dy = Number(pointB.y) - Number(pointA.y);
        const length = Math.hypot(dx, dy);
        if (length <= 1e-6) {
            return [
                { x: pointA.x - halfSize, y: pointA.y - halfSize },
                { x: pointA.x + halfSize, y: pointA.y - halfSize },
                { x: pointA.x + halfSize, y: pointA.y + halfSize },
                { x: pointA.x - halfSize, y: pointA.y + halfSize }
            ];
        }
        const ux = dx / length;
        const uy = dy / length;
        const px = -uy * halfSize;
        const py = ux * halfSize;
        return [
            { x: pointA.x - px, y: pointA.y - py },
            { x: pointB.x - px, y: pointB.y - py },
            { x: pointB.x + px, y: pointB.y + py },
            { x: pointA.x + px, y: pointA.y + py }
        ];
    }

    function detectionClipSegmentToBounds(pointA, pointB, bounds) {
        const dx = Number(pointB.x) - Number(pointA.x);
        const dy = Number(pointB.y) - Number(pointA.y);
        let tMin = 0;
        let tMax = 1;
        const tests = [
            [-dx, Number(pointA.x) - bounds.minX],
            [dx, bounds.maxX - Number(pointA.x)],
            [-dy, Number(pointA.y) - bounds.minY],
            [dy, bounds.maxY - Number(pointA.y)]
        ];

        for (const [pValue, qValue] of tests) {
            if (Math.abs(pValue) < 1e-12) {
                if (qValue < 0) return null;
                continue;
            }
            const tValue = qValue / pValue;
            if (pValue < 0) {
                tMin = Math.max(tMin, tValue);
            } else {
                tMax = Math.min(tMax, tValue);
            }
            if (tMin > tMax) return null;
        }

        return [
            { x: Number(pointA.x) + (tMin * dx), y: Number(pointA.y) + (tMin * dy) },
            { x: Number(pointA.x) + (tMax * dx), y: Number(pointA.y) + (tMax * dy) }
        ];
    }

    function detectionComputeLineCoverage(lineCandidates, bounds) {
        let totalLineLength = 0;
        let coveredLineLength = 0;
        const seenLineKeys = new Set();
        lineCandidates.forEach(lineCandidate => {
            if (!lineCandidate || seenLineKeys.has(lineCandidate.key)) return;
            seenLineKeys.add(lineCandidate.key);
            totalLineLength += lineCandidate.length;
            const clippedSegment = detectionClipSegmentToBounds(lineCandidate.pointA, lineCandidate.pointB, bounds);
            if (!clippedSegment) return;
            coveredLineLength += detectionDistance(clippedSegment[0], clippedSegment[1]);
        });
        return {
            ratio: totalLineLength > 1e-6 ? coveredLineLength / totalLineLength : 0,
            coveredLineLength,
            totalLineLength
        };
    }

    function detectionBuildGroupCandidate(seed, nearbyLines) {
        const seedDirection = detectionLineUnitDirection(seed.pointA, seed.pointB);
        if (!seedDirection) {
            return { pointA: seed.pointA, pointB: seed.pointB, lineCandidates: [seed] };
        }

        const origin = seed.pointA;
        const group = [seed];
        const groupKeys = new Set([seed.key]);
        let groupProjectionRange = detectionLineProjectionRange(seed, origin, seedDirection);
        let changed = true;

        while (changed) {
            changed = false;
            nearbyLines.forEach(lineCandidate => {
                if (groupKeys.has(lineCandidate.key) || lineCandidate.layerName !== seed.layerName) return;
                const candidateDirection = detectionLineUnitDirection(lineCandidate.pointA, lineCandidate.pointB);
                if (detectionUndirectedAngleDegrees(seedDirection, candidateDirection) > DETECTION_PARALLEL_MAX_ANGLE_DEGREES) return;
                if (detectionLineAxisOffset(lineCandidate, origin, seedDirection) > DETECTION_MERGE_AXIS_OFFSET) return;
                const candidateProjectionRange = detectionLineProjectionRange(lineCandidate, origin, seedDirection);
                if (detectionProjectionGap(groupProjectionRange, candidateProjectionRange) > DETECTION_MERGE_ENDPOINT_GAP) return;
                group.push(lineCandidate);
                groupKeys.add(lineCandidate.key);
                groupProjectionRange = [
                    Math.min(groupProjectionRange[0], candidateProjectionRange[0]),
                    Math.max(groupProjectionRange[1], candidateProjectionRange[1])
                ];
                changed = true;
            });
        }

        let minProjection = Infinity;
        let maxProjection = -Infinity;
        let pointA = seed.pointA;
        let pointB = seed.pointB;
        group.forEach(lineCandidate => {
            [lineCandidate.pointA, lineCandidate.pointB].forEach(point => {
                const projection = detectionProjectPoint(point, origin, seedDirection);
                if (projection < minProjection) {
                    minProjection = projection;
                    pointA = point;
                }
                if (projection > maxProjection) {
                    maxProjection = projection;
                    pointB = point;
                }
            });
        });

        return {
            pointA,
            pointB,
            lineCandidates: group.slice().sort((left, right) => left.key.localeCompare(right.key))
        };
    }

    function detectionGetManualLineCandidateForKey(lineKey) {
        if (!lineKey || typeof snapPointLineItems === 'undefined' || !(snapPointLineItems instanceof Map)) {
            return null;
        }
        return snapPointLineItems.get(lineKey) || null;
    }

    function detectionBuildManualStyleGroupedLineCandidate(seedLineCandidate, nearbyLines) {
        const manualSeedLineCandidate = detectionGetManualLineCandidateForKey(seedLineCandidate?.key);
        if (manualSeedLineCandidate && typeof collectStraightGroupedLineCandidates === 'function') {
            const groupedManualLineCandidates = collectStraightGroupedLineCandidates(manualSeedLineCandidate, new Set());
            const groupedLineCandidates = groupedManualLineCandidates
                .map(detectionConvertManualLineCandidate)
                .filter(Boolean);
            const normalizedSeedLineCandidate = detectionConvertManualLineCandidate(manualSeedLineCandidate);
            if (normalizedSeedLineCandidate && groupedLineCandidates.length) {
                const groupCandidate = detectionBuildGroupCandidate(normalizedSeedLineCandidate, groupedLineCandidates);
                const groupedLineCandidate = detectionCreateGroupedLineCandidate(groupCandidate, normalizedSeedLineCandidate);
                if (groupedLineCandidate) {
                    return groupedLineCandidate;
                }
            }
        }

        const localGroupCandidate = detectionBuildGroupCandidate(seedLineCandidate, nearbyLines);
        return detectionCreateGroupedLineCandidate(localGroupCandidate, seedLineCandidate);
    }

    function detectionCreateGroupedLineCandidate(groupCandidate, fallbackLineCandidate) {
        const lineCandidates = Array.isArray(groupCandidate?.lineCandidates) && groupCandidate.lineCandidates.length
            ? groupCandidate.lineCandidates
            : [fallbackLineCandidate].filter(Boolean);
        const layerName = lineCandidates[0]?.layerName || fallbackLineCandidate?.layerName || null;
        const pointA = groupCandidate?.pointA || fallbackLineCandidate?.pointA || null;
        const pointB = groupCandidate?.pointB || fallbackLineCandidate?.pointB || null;
        if (!layerName || !pointA || !pointB) return null;

        const normalizedPointA = {
            x: Number(pointA.x),
            y: Number(pointA.y),
            layerName
        };
        const normalizedPointB = {
            x: Number(pointB.x),
            y: Number(pointB.y),
            layerName
        };
        if (![normalizedPointA.x, normalizedPointA.y, normalizedPointB.x, normalizedPointB.y].every(Number.isFinite)) {
            return null;
        }

        const bbox = detectionBoundsFromPointPairs([
            [normalizedPointA.x, normalizedPointA.y],
            [normalizedPointB.x, normalizedPointB.y]
        ]);
        if (!bbox) return null;

        const matchedLineKeys = Array.from(new Set(
            lineCandidates
                .map(lineCandidate => lineCandidate?.key)
                .filter(Boolean)
        )).sort();
        const key = matchedLineKeys.join('||') || fallbackLineCandidate?.key || createNormalizedLineKey(layerName, normalizedPointA, normalizedPointB);

        return {
            key,
            layerName,
            pointA: normalizedPointA,
            pointB: normalizedPointB,
            bbox,
            length: detectionDistance(normalizedPointA, normalizedPointB),
            lineCandidates,
            matchedLineKeys: matchedLineKeys.length ? matchedLineKeys : [key]
        };
    }

    function detectionScoreCandidatePolygon(query, pointAWorld, pointBWorld, pointAPx, pointBPx, polygonPx) {
        const polygonPxBounds = detectionBoundsFromPointPairs(polygonPx);
        if (!polygonPxBounds) {
            return { score: Infinity, iou: 0, centerlineGapPx: Infinity, angleGapDegrees: 90 };
        }
        const lineDirection = detectionLineUnitDirection(pointAWorld, pointBWorld);
        const angleGapDegrees = detectionUndirectedAngleDegrees(query.axisWorld, lineDirection);
        const centerlineGapPx = detectionPointDistanceToSegment(query.centerPx, { x: pointAPx[0], y: pointAPx[1] }, { x: pointBPx[0], y: pointBPx[1] });
        const lengthGapPx = Math.abs(Math.hypot(pointBPx[0] - pointAPx[0], pointBPx[1] - pointAPx[1]) - query.majorLengthPx);
        const centerPoint = detectionMidpoint({ x: pointAPx[0], y: pointAPx[1] }, { x: pointBPx[0], y: pointBPx[1] });
        const centerGapPx = detectionDistance(centerPoint, query.centerPx);
        const aabbGapPx = Math.abs(polygonPxBounds.minX - query.bboxPx.minX)
            + Math.abs(polygonPxBounds.minY - query.bboxPx.minY)
            + Math.abs(polygonPxBounds.maxX - query.bboxPx.maxX)
            + Math.abs(polygonPxBounds.maxY - query.bboxPx.maxY);
        const iou = detectionBoundsIou(polygonPxBounds, query.bboxPx);
        return {
            score: aabbGapPx
                + (centerGapPx * 1)
                + (centerlineGapPx * 1.5)
                + (lengthGapPx * 0.5)
                + (angleGapDegrees * 8)
                + ((1 - iou) * 25),
            iou,
            centerlineGapPx,
            angleGapDegrees
        };
    }

    function detectionBuildMatchResult(query, context, pointAWorld, pointBWorld, lineCandidates) {
        const clippedSegment = detectionClipSegmentToBounds(pointAWorld, pointBWorld, query.bboxWorld);
        if (!clippedSegment) return null;
        const layerName = pointAWorld.layerName || pointBWorld.layerName || lineCandidates[0]?.layerName || null;
        const seedPointA = { x: clippedSegment[0].x, y: clippedSegment[0].y, layerName };
        const seedPointB = { x: clippedSegment[1].x, y: clippedSegment[1].y, layerName };
        const bboxCoverageRatio = detectionClippedSegmentBboxCoverageRatio([seedPointA, seedPointB], query, context);
        if (bboxCoverageRatio <= 1e-6) return null;

        const manualBboxPts = Number(CONFIG.MANUAL_LABEL_BBOX_PTS) || 5;
        const worldPolygon = detectionBuildManualConnectWorldPolygon(seedPointA, seedPointB, manualBboxPts / 2);
        const pixelPolygon = worldPolygon.map(point => detectionWorldPointToPixel(point, context));
        const clippedPolygon = typeof clipObbToRect === 'function'
            ? clipObbToRect(pixelPolygon, context.imageWidth, context.imageHeight)
            : pixelPolygon;
        if (!clippedPolygon) return null;

        const pointAPx = detectionWorldPointToPixel(seedPointA, context);
        const pointBPx = detectionWorldPointToPixel(seedPointB, context);
        const score = detectionScoreCandidatePolygon(query, seedPointA, seedPointB, pointAPx, pointBPx, clippedPolygon);
        const pixelBounds = detectionBoundsFromPointPairs(clippedPolygon);
        if (!pixelBounds) return null;
        const coverage = detectionComputeLineCoverage(lineCandidates, query.bboxWorld);

        return {
            pixelPolygon: clippedPolygon,
            pixelBounds,
            worldPointA: pointAWorld,
            worldPointB: pointBWorld,
            seedPointA,
            seedPointB,
            layerName,
            lineKeys: Array.from(new Set(lineCandidates.map(lineCandidate => lineCandidate.key))).sort(),
            manualSegments: lineCandidates.map(lineCandidate => [
                { x: lineCandidate.pointA.x, y: lineCandidate.pointA.y, layerName: lineCandidate.layerName },
                { x: lineCandidate.pointB.x, y: lineCandidate.pointB.y, layerName: lineCandidate.layerName }
            ]),
            score: score.score,
            iou: score.iou,
            centerlineGapPx: score.centerlineGapPx,
            angleGapDegrees: score.angleGapDegrees,
            lineCoverageRatio: coverage.ratio,
            bboxCoverageRatio,
            coveredLineLength: coverage.coveredLineLength,
            matchedLineLength: coverage.totalLineLength
        };
    }

    function detectionMatchConnectToManualObb(detection, spatialIndex, context) {
        const query = detectionResolveQuery(detection, context);
        if (!query) return null;

        let nearbyLines = [];
        for (const multiplier of [1, 2]) {
            nearbyLines = spatialIndex.query(detectionExpandBounds(query.bboxWorld, DETECTION_DEFAULT_SEARCH_PADDING * multiplier));
            if (nearbyLines.length) break;
        }
        if (!nearbyLines.length) return null;

        let bestSeedMatch = null;
        let bestSeedLine = null;
        let bestSeedRank = null;
        nearbyLines.forEach(lineCandidate => {
            const seedMatch = detectionBuildMatchResult(query, context, lineCandidate.pointA, lineCandidate.pointB, [lineCandidate]);
            if (!seedMatch) return;
            const seedRank = [
                seedMatch.bboxCoverageRatio >= DETECTION_MIN_LINE_COVERAGE_RATIO ? 0 : 1,
                seedMatch.score,
                -seedMatch.bboxCoverageRatio,
                seedMatch.centerlineGapPx
            ];
            if (!bestSeedRank || detectionCompareRank(seedRank, bestSeedRank) < 0) {
                bestSeedRank = seedRank;
                bestSeedMatch = seedMatch;
                bestSeedLine = lineCandidate;
            }
        });
        if (!bestSeedMatch || !bestSeedLine) return null;

        const groupedLineCandidate = detectionBuildManualStyleGroupedLineCandidate(bestSeedLine, nearbyLines);
        const mergedMatch = detectionBuildMatchResult(
            query,
            context,
            groupedLineCandidate.pointA,
            groupedLineCandidate.pointB,
            Array.isArray(groupedLineCandidate.lineCandidates) && groupedLineCandidate.lineCandidates.length
                ? groupedLineCandidate.lineCandidates
                : [groupedLineCandidate]
        );
        const candidateMatches = [bestSeedMatch, mergedMatch]
            .filter(matchResult => matchResult && matchResult.bboxCoverageRatio >= DETECTION_MIN_LINE_COVERAGE_RATIO);
        if (!candidateMatches.length) return null;

        const resolvedMatch = candidateMatches.slice().sort((left, right) => detectionCompareRank([
            left.lineKeys.length > bestSeedMatch.lineKeys.length ? 0 : 1,
            left.score,
            -left.bboxCoverageRatio,
            -left.lineKeys.length,
            left.centerlineGapPx
        ], [
            right.lineKeys.length > bestSeedMatch.lineKeys.length ? 0 : 1,
            right.score,
            -right.bboxCoverageRatio,
            -right.lineKeys.length,
            right.centerlineGapPx
        ]))[0];
        const manualBboxPts = Number(CONFIG.MANUAL_LABEL_BBOX_PTS) || 5;
        const shortEdgePx = Math.max(query.minorLengthPx, manualBboxPts * Math.min(context.scaleX, context.scaleY));
        if (resolvedMatch.iou < 0.03 && resolvedMatch.centerlineGapPx > Math.max(shortEdgePx, 12)) return null;
        if (resolvedMatch.angleGapDegrees > 20 && resolvedMatch.centerlineGapPx > Math.max(shortEdgePx, 12)) return null;
        return resolvedMatch;
    }

    function detectionCollectEndpointJunctionMatches(detectionEntries, candidate, context) {
        if (!Array.isArray(detectionEntries) || !candidate?.points?.length) return [];
        const endpointMatchesByKey = new Map();
        detectionEntries.forEach((detection, detectionIndex) => {
            if (!detectionIsJunctionClass(detection?.class_name)) return;
            const query = detectionResolveQuery(detection, context);
            if (!query) return;
            const junctionPadding = Math.max(
                detectionGetLineAttachToleranceWorld(),
                Math.abs(query.bboxWorld.width) / 2,
                Math.abs(query.bboxWorld.height) / 2,
                0.75
            );
            candidate.points.forEach(endpoint => {
                if (!endpoint || endpoint.layerName !== candidate.layerName) return;
                const endpointInsideJunction = detectionIsPointInsideBounds(endpoint, query.bboxWorld, junctionPadding);
                const endpointDistance = detectionDistance(endpoint, query.centerWorld);
                if (!endpointInsideJunction && endpointDistance > junctionPadding * 2) return;
                const endpointKey = getSnapPointKey(candidate.layerName, endpoint.x, endpoint.y);
                const match = {
                    point: {
                        x: Number(endpoint.x),
                        y: Number(endpoint.y),
                        layerName: candidate.layerName
                    },
                    detectionIndex,
                    confidence: detection.confidence,
                    distance: endpointDistance,
                    score: endpointInsideJunction ? endpointDistance : endpointDistance + junctionPadding
                };
                const existingMatch = endpointMatchesByKey.get(endpointKey);
                if (!existingMatch || match.score < existingMatch.score) {
                    endpointMatchesByKey.set(endpointKey, match);
                }
            });
        });
        return Array.from(endpointMatchesByKey.values())
            .sort((left, right) => detectionCompareRank([
                left.score,
                -Number(left.confidence || 0),
                left.detectionIndex
            ], [
                right.score,
                -Number(right.confidence || 0),
                right.detectionIndex
            ]));
    }

    function detectionCreateApproximateConnectCandidate(detection, detectionIndex, matchResult, detectionEntries, context) {
        if (!matchResult?.layerName || !matchResult.worldPointA || !matchResult.worldPointB) return null;
        const lineKeySeed = matchResult.lineKeys.length ? matchResult.lineKeys.join('||') : matchResult.layerName;
        const candidate = {
            id: `bbox-line-seed:${detectionIndex}:${lineKeySeed}`,
            layerName: matchResult.layerName,
            points: [matchResult.worldPointA, matchResult.worldPointB],
            junctionPoints: [],
            lineKeys: matchResult.lineKeys,
            sourceLineKeys: matchResult.lineKeys,
            segments: matchResult.manualSegments,
            confidence: detection.confidence,
            coverageRatio: matchResult.bboxCoverageRatio,
            segmentCoverageRatio: matchResult.lineCoverageRatio,
            bboxLengthCoverageRatio: matchResult.bboxCoverageRatio,
            score: matchResult.score,
            sourceConnectDetectionIndex: detectionIndex,
            sourceJunctionDetectionIndexes: [],
            validationMethod: 'bbox-line-seed',
            iou: matchResult.iou,
            centerlineGapPx: matchResult.centerlineGapPx,
            angleGapDegrees: matchResult.angleGapDegrees
        };
        const endpointJunctionMatches = detectionCollectEndpointJunctionMatches(detectionEntries, candidate, context);
        candidate.junctionPoints = endpointJunctionMatches.map(match => match.point);
        candidate.sourceJunctionDetectionIndexes = endpointJunctionMatches.map(match => match.detectionIndex);
        return candidate;
    }

    function detectionBuildApproximateConnectSeeds(detectionEntries, spatialIndex, context) {
        return detectionEntries
            .map((detection, detectionIndex) => {
                if (!detectionIsConnectClass(detection?.class_name)) return null;
                const matchResult = detectionMatchConnectToManualObb(detection, spatialIndex, context);
                return detectionCreateApproximateConnectCandidate(detection, detectionIndex, matchResult, detectionEntries, context);
            })
            .filter(Boolean)
            .sort((left, right) => detectionCompareRank([
                left.sourceConnectDetectionIndex,
                left.score,
                -left.coverageRatio
            ], [
                right.sourceConnectDetectionIndex,
                right.score,
                -right.coverageRatio
            ]));
    }

    function detectionCompareRank(rankA, rankB) {
        for (let index = 0; index < Math.min(rankA.length, rankB.length); index += 1) {
            if (rankA[index] < rankB[index]) return -1;
            if (rankA[index] > rankB[index]) return 1;
        }
        return rankA.length - rankB.length;
    }

    function detectionGetLineAttachToleranceWorld() {
        if (typeof getManualLineAttachToleranceWorld === 'function') {
            return Math.max(Number(getManualLineAttachToleranceWorld()) || 0, 1e-4);
        }
        return 1;
    }

    function detectionIsPointInsideBounds(point, bounds, padding = 0) {
        return Boolean(point && bounds)
            && Number(point.x) >= bounds.minX - padding
            && Number(point.x) <= bounds.maxX + padding
            && Number(point.y) >= bounds.minY - padding
            && Number(point.y) <= bounds.maxY + padding;
    }

    function detectionClippedSegmentBboxCoverageRatio(clippedSegment, query, context) {
        const bboxMajorLength = Number(query?.majorLengthPx) || 0;
        if (!Array.isArray(clippedSegment) || clippedSegment.length < 2 || bboxMajorLength <= 1e-6) return 0;
        const pointAPx = detectionWorldPointToPixel(clippedSegment[0], context);
        const pointBPx = detectionWorldPointToPixel(clippedSegment[1], context);
        const clippedLengthPx = Math.hypot(pointBPx[0] - pointAPx[0], pointBPx[1] - pointAPx[1]);
        return Math.min(clippedLengthPx / bboxMajorLength, 1);
    }

    function detectionBuildJunctionGuidedDetection(candidate, candidateIndex, context) {
        const manualBboxPts = Number(CONFIG.MANUAL_LABEL_BBOX_PTS) || 5;
        const worldPolygon = detectionBuildManualConnectWorldPolygon(candidate.points[0], candidate.points[1], manualBboxPts / 2);
        const pixelPolygon = worldPolygon.map(point => detectionWorldPointToPixel(point, context));
        const clippedPolygon = typeof clipObbToRect === 'function'
            ? clipObbToRect(pixelPolygon, context.imageWidth, context.imageHeight)
            : pixelPolygon;
        const pixelBounds = detectionBoundsFromPointPairs(clippedPolygon || []);
        if (!pixelBounds) return null;

        return {
            class_id: 1,
            class_name: 'connect',
            confidence: detectionRound(candidate.confidence || 0, 6),
            obb: clippedPolygon.map(point => [Math.round(point[0]), Math.round(point[1])]),
            aabb: detectionBoundsToAabb(pixelBounds).map(value => detectionRound(value, 3)),
            postprocess: {
                validated: true,
                method: candidate.validationMethod || 'junction-guided',
                layer_name: candidate.layerName,
                manual_points: candidate.points.map(point => ({
                    x: detectionRound(point.x, 6),
                    y: detectionRound(point.y, 6),
                    layerName: candidate.layerName
                })),
                manual_segments: candidate.segments.map(segment => segment.map(point => ({
                    x: detectionRound(point.x, 6),
                    y: detectionRound(point.y, 6),
                    layerName: candidate.layerName
                }))),
                matched_line_keys: candidate.lineKeys,
                source_line_keys: candidate.sourceLineKeys,
                source_connect_detection_index: candidate.sourceConnectDetectionIndex,
                source_junction_detection_indexes: candidate.sourceJunctionDetectionIndexes,
                source_junction_points: Array.isArray(candidate.junctionPoints)
                    ? candidate.junctionPoints.map(point => ({
                        x: detectionRound(point.x, 6),
                        y: detectionRound(point.y, 6),
                        layerName: candidate.layerName
                    }))
                    : [],
                bbox_coverage_ratio: detectionRound(candidate.coverageRatio, 6),
                segment_inside_bbox_ratio: detectionRound(candidate.segmentCoverageRatio ?? candidate.coverageRatio, 6),
                bbox_length_coverage_ratio: detectionRound(candidate.bboxLengthCoverageRatio ?? candidate.coverageRatio, 6),
                iou: detectionRound(candidate.iou ?? 0, 6),
                centerline_gap_px: detectionRound(candidate.centerlineGapPx ?? 0, 6),
                angle_gap_degrees: detectionRound(candidate.angleGapDegrees ?? 0, 6),
                score: detectionRound(candidate.score, 6),
                synthetic_index: candidateIndex
            }
        };
    }

    function adjustDetectionConnectsForVisibleLines(detectionJson, exportContext) {
        const imageSize = detectionJson?.image_size || {};
        const imageWidth = Number(imageSize.width || exportContext.imageWidth);
        const imageHeight = Number(imageSize.height || exportContext.imageHeight);
        if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || imageWidth <= 0 || imageHeight <= 0) {
            throw new Error('Detection JSON thieu image_size hop le.');
        }

        const context = {
            ...exportContext,
            imageWidth,
            imageHeight,
            scaleX: imageWidth / exportContext.bounds.width,
            scaleY: imageHeight / exportContext.bounds.height
        };
        const lineCandidates = detectionBuildVisibleLineCandidates();
        const spatialIndex = detectionBuildLineSpatialIndex(lineCandidates);
        const adjustedDetectionJson = detectionClone(detectionJson);
        const detectionEntries = Array.isArray(adjustedDetectionJson.detections) ? adjustedDetectionJson.detections : [];
        const outputDetectionEntries = [];
        const rejectedDetectionEntries = [];
        const approximateConnectSeeds = detectionBuildApproximateConnectSeeds(detectionEntries, spatialIndex, context);
        const connectDetectionIndexesWithCandidate = new Set(
            approximateConnectSeeds.map(candidate => candidate.sourceConnectDetectionIndex)
        );
        let totalConnectDetections = 0;
        let validatedConnectDetections = 0;
        let rejectedConnectDetections = 0;

        detectionEntries.forEach((detection, detectionIndex) => {
            if (!detection || typeof detection !== 'object') return;
            if (!detectionIsConnectClass(detection.class_name)) {
                outputDetectionEntries.push(detectionClone(detection));
                return;
            }

            totalConnectDetections += 1;
            if (!connectDetectionIndexesWithCandidate.has(detectionIndex)) {
                rejectedConnectDetections += 1;
                rejectedDetectionEntries.push(detectionClone(detection));
            }
        });

        approximateConnectSeeds.forEach((candidate, candidateIndex) => {
            const validatedDetection = detectionBuildJunctionGuidedDetection(candidate, candidateIndex, context);
            if (!validatedDetection) return;
            outputDetectionEntries.push(validatedDetection);
            validatedConnectDetections += 1;
        });

        adjustedDetectionJson.detections = outputDetectionEntries;
        adjustedDetectionJson.num_detections = outputDetectionEntries.length;
        adjustedDetectionJson.rejected_connect_detections = rejectedDetectionEntries;
        adjustedDetectionJson.postprocess = {
            validated_connect_detections: validatedConnectDetections,
            rejected_connect_detections: rejectedConnectDetections,
            total_connect_detections: totalConnectDetections,
            connect_validation_method: 'bbox-line-seed',
            min_bbox_coverage_ratio: DETECTION_MIN_LINE_COVERAGE_RATIO,
            manual_bbox_pts: Number(CONFIG.MANUAL_LABEL_BBOX_PTS) || 5,
            search_padding_pts: DETECTION_DEFAULT_SEARCH_PADDING,
            num_line_candidates: lineCandidates.length,
            resolved_junction_points: [],
            bbox_line_seed_connects: approximateConnectSeeds.map(candidate => ({
                layerName: candidate.layerName,
                points: candidate.points.map(point => ({
                    x: detectionRound(point.x, 6),
                    y: detectionRound(point.y, 6),
                    layerName: candidate.layerName
                })),
                lineKeys: candidate.lineKeys,
                segments: candidate.segments.map(segment => segment.map(point => ({
                    x: detectionRound(point.x, 6),
                    y: detectionRound(point.y, 6),
                    layerName: candidate.layerName
                }))),
                sourceLineKeys: candidate.sourceLineKeys,
                sourceConnectDetectionIndex: candidate.sourceConnectDetectionIndex,
                sourceJunctionDetectionIndexes: candidate.sourceJunctionDetectionIndexes,
                bboxCoverageRatio: detectionRound(candidate.coverageRatio, 6),
                segmentInsideBboxRatio: detectionRound(candidate.segmentCoverageRatio ?? candidate.coverageRatio, 6),
                bboxLengthCoverageRatio: detectionRound(candidate.bboxLengthCoverageRatio ?? candidate.coverageRatio, 6),
                iou: detectionRound(candidate.iou ?? 0, 6),
                centerlineGapPx: detectionRound(candidate.centerlineGapPx ?? 0, 6),
                angleGapDegrees: detectionRound(candidate.angleGapDegrees ?? 0, 6),
                score: detectionRound(candidate.score, 6)
            }))
        };

        return adjustedDetectionJson;
    }

    function detectionPixelPolygonToWorldPolygon(pixelPolygon, context) {
        return pixelPolygon
            .map(point => {
                if (!Array.isArray(point) || point.length < 2) return null;
                const pointX = detectionSafeNumber(point[0]);
                const pointY = detectionSafeNumber(point[1]);
                if (pointX === null || pointY === null) return null;
                const worldPoint = detectionPixelPointToWorld({ x: pointX, y: pointY }, context);
                return [worldPoint.x, worldPoint.y];
            })
            .filter(Boolean);
    }

    function detectionAabbToPolygon(aabb) {
        const bounds = detectionBoundsFromAabb(aabb || []);
        if (!bounds) return [];
        return [
            [bounds.minX, bounds.minY],
            [bounds.maxX, bounds.minY],
            [bounds.maxX, bounds.maxY],
            [bounds.minX, bounds.maxY]
        ];
    }

    function detectionCreateOverlayShape(detection, context, shapeIndex) {
        const pixelPolygon = Array.isArray(detection?.obb) && detection.obb.length >= 3
            ? detection.obb
            : detectionAabbToPolygon(detection?.aabb);
        const worldPolygon = detectionPixelPolygonToWorldPolygon(pixelPolygon, context);
        if (worldPolygon.length < 3) return null;
        const bounds = detectionBoundsFromPointPairs(worldPolygon);
        if (!bounds) return null;
        const className = detectionNormalizeClassName(detection.class_name);
        const shape = {
            id: `detect_${className}_${shapeIndex}`,
            layer: `${DETECTION_LAYER_PREFIX}${className}`,
            items: [['poly', worldPolygon]],
            color: detectionGetClassColor(className),
            width: Math.max(0.8, 2 / Math.max(context.scaleX, context.scaleY)),
            fill: null,
            rect: detectionBoundsToAabb(bounds),
            seqno: 900000000 + shapeIndex
        };
        return prepareShapeForDraw(shape, DETECTION_RENDER_PRIORITY, true);
    }

    function detectionHexToRgba(hexColor, alpha = 1) {
        if (typeof hexColor !== 'string') return `rgba(15, 23, 42, ${alpha})`;
        const normalized = hexColor.replace('#', '').trim();
        const parsed = normalized.length === 3
            ? normalized.split('').map(value => value + value).join('')
            : normalized;
        if (parsed.length !== 6) return `rgba(15, 23, 42, ${alpha})`;
        const red = Number.parseInt(parsed.slice(0, 2), 16);
        const green = Number.parseInt(parsed.slice(2, 4), 16);
        const blue = Number.parseInt(parsed.slice(4, 6), 16);
        if (![red, green, blue].every(Number.isFinite)) {
            return `rgba(15, 23, 42, ${alpha})`;
        }
        return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
    }

    function detectionGetOverlayStyle(entry = null) {
        const annotationType = String(entry?.annotationType || entry?.className || '').trim().toLowerCase();
        if (annotationType === 'connect' || annotationType === 'junction') {
            const baseColor = DETECTION_ANNOTATION_COLORS[annotationType];
            return {
                stroke: baseColor,
                fill: detectionHexToRgba(baseColor, 0.12),
                point: baseColor,
                labelFill: detectionHexToRgba(baseColor, 0.92)
            };
        }

        const fallbackColor = detectionGetClassColor(annotationType || 'default');
        return {
            stroke: toRgbString(fallbackColor),
            fill: toRgbString(fallbackColor, 0.12),
            point: toRgbString(fallbackColor),
            labelFill: toRgbString(fallbackColor, 0.92)
        };
    }

    function detectionGetOverlayHalfSizeWorld() {
        if (typeof getManualLabelHalfSizeWorld === 'function') {
            const halfSizeWorld = Number(getManualLabelHalfSizeWorld());
            if (Number.isFinite(halfSizeWorld) && halfSizeWorld > 0) {
                return halfSizeWorld;
            }
        }
        return Math.max(3 / Math.max(zoom, 0.01), 1 / Math.max(zoom, 0.01));
    }

    function detectionDrawWorldPolygonPath(targetCtx, polygon) {
        if (typeof drawWorldPolygon === 'function') {
            drawWorldPolygon(targetCtx, polygon);
            return;
        }
        if (!Array.isArray(polygon) || !polygon.length) return;
        targetCtx.beginPath();
        targetCtx.moveTo(polygon[0].x, polygon[0].y);
        for (let index = 1; index < polygon.length; index += 1) {
            targetCtx.lineTo(polygon[index].x, polygon[index].y);
        }
        targetCtx.closePath();
    }

    function detectionDrawWorldPointMarker(targetCtx, point, color, radiusWorld) {
        if (typeof drawWorldPoint === 'function') {
            drawWorldPoint(targetCtx, point, color, radiusWorld);
            return;
        }
        targetCtx.beginPath();
        targetCtx.arc(point.x, point.y, radiusWorld, 0, Math.PI * 2);
        targetCtx.fillStyle = color;
        targetCtx.fill();
    }

    function detectionNormalizeAnnotationPoint(point, fallbackLayerName = '') {
        if (!point || typeof point !== 'object') return null;
        const pointX = detectionSafeNumber(point.x);
        const pointY = detectionSafeNumber(point.y);
        if (pointX === null || pointY === null) return null;
        return {
            x: pointX,
            y: pointY,
            layerName: String(point.layerName || point.layer_name || fallbackLayerName || '').trim()
        };
    }

    function detectionNormalizeAnnotationSegments(segments, fallbackLayerName = '') {
        if (!Array.isArray(segments)) return [];
        return segments
            .map(segment => {
                if (!Array.isArray(segment) || segment.length < 2) return null;
                const normalizedSegment = segment
                    .slice(0, 2)
                    .map(point => detectionNormalizeAnnotationPoint(point, fallbackLayerName))
                    .filter(Boolean);
                return normalizedSegment.length >= 2 ? normalizedSegment : null;
            })
            .filter(Boolean);
    }

    function detectionBuildFallbackAnnotationPolygon(annotation) {
        if (!annotation || !Array.isArray(annotation.points) || !annotation.points.length) return null;
        const halfSize = detectionGetOverlayHalfSizeWorld();
        if (annotation.type === 'junction') {
            const center = annotation.points[0];
            return [
                { x: center.x - halfSize, y: center.y - halfSize },
                { x: center.x + halfSize, y: center.y - halfSize },
                { x: center.x + halfSize, y: center.y + halfSize },
                { x: center.x - halfSize, y: center.y + halfSize }
            ];
        }
        if (!annotation.points[1]) return null;
        return detectionBuildManualConnectWorldPolygon(annotation.points[0], annotation.points[1], halfSize);
    }

    function detectionGetAnnotationOverlayPolygon(annotation) {
        if (typeof getManualAnnotationWorldPolygon === 'function') {
            const polygon = getManualAnnotationWorldPolygon(annotation);
            if (Array.isArray(polygon) && polygon.length >= 3) {
                return polygon;
            }
        }
        return detectionBuildFallbackAnnotationPolygon(annotation);
    }

    function detectionCreateAnnotationOverlayEntry(annotation) {
        if (!annotation || typeof annotation !== 'object') return null;
        const annotationType = annotation.type === 'junction' ? 'junction' : 'connect';
        const fallbackLayerName = String(annotation.layerName || annotation.layer_name || '').trim();
        const normalizedPoints = (annotation.points || annotation.manual_points || [])
            .map(point => detectionNormalizeAnnotationPoint(point, fallbackLayerName))
            .filter(Boolean);
        if (annotationType === 'connect' && normalizedPoints.length < 2) return null;
        if (annotationType === 'junction' && !normalizedPoints.length) return null;

        const overlayAnnotation = {
            type: annotationType,
            layerName: normalizedPoints[0]?.layerName || fallbackLayerName,
            points: annotationType === 'junction' ? [normalizedPoints[0]] : normalizedPoints.slice(0, 2),
            segments: detectionNormalizeAnnotationSegments(annotation.segments || annotation.manual_segments || [], normalizedPoints[0]?.layerName || fallbackLayerName)
        };
        const polygon = detectionGetAnnotationOverlayPolygon(overlayAnnotation);
        if (!polygon) return null;
        return {
            polygon,
            points: overlayAnnotation.points,
            segments: overlayAnnotation.segments,
            annotationType,
            className: annotationType,
            layerName: overlayAnnotation.layerName,
            labelText: '',
            pointScale: overlayAnnotation.type === 'junction' ? 1.05 : 1
        };
    }

    function detectionBuildDetectionPolygonOverlayEntry(detection, context, options = {}) {
        const pixelPolygon = Array.isArray(detection?.obb) && detection.obb.length >= 3
            ? detection.obb
            : detectionAabbToPolygon(detection?.aabb);
        const polygon = detectionPixelPolygonToWorldPolygon(pixelPolygon, context)
            .map(point => Array.isArray(point) && point.length >= 2 ? { x: Number(point[0]), y: Number(point[1]) } : null)
            .filter(Boolean);
        if (polygon.length < 3) return null;

        const confidence = detectionSafeNumber(detection?.confidence);
        const shouldEnforceConfidence = options.enforceConfidence !== false;
        if (shouldEnforceConfidence) {
            const confidenceDisplayThreshold = detectionGetConfidenceDisplayThreshold();
            if (confidence === null || confidence < confidenceDisplayThreshold) return null;
        }

        const className = detectionNormalizeClassName(detection?.class_name).toLowerCase();
        const annotationType = detectionIsJunctionClass(className)
            ? 'junction'
            : (detectionIsConnectClass(className) ? 'connect' : className);

        return {
            polygon,
            points: [],
            segments: [],
            annotationType,
            className,
            layerName: String(detection?.postprocess?.layer_name || detection?.layer_name || '').trim(),
            labelText: options.includeLabel === true ? detectionFormatConfidenceLabel(confidence) : '',
            labelBounds: detectionBoundsFromPointPairs(polygon)
        };
    }

    function detectionBuildProcessedOverlayEntry(detection, context) {
        const className = detectionNormalizeClassName(detection?.class_name);
        const postprocess = detection?.postprocess || {};
        const fallbackLayerName = String(postprocess.layer_name || detection?.layer_name || detection?.layerName || '').trim();
        if (detectionIsConnectClass(className)) {
            const connectEntry = detectionCreateAnnotationOverlayEntry({
                type: 'connect',
                layerName: fallbackLayerName,
                points: postprocess.manual_points || detection?.points,
                segments: postprocess.manual_segments || detection?.segments
            });
            if (connectEntry) return connectEntry;
        }
        if (detectionIsJunctionClass(className)) {
            const junctionEntry = detectionCreateAnnotationOverlayEntry({
                type: 'junction',
                layerName: fallbackLayerName,
                points: postprocess.manual_points || detection?.points
            });
            if (junctionEntry) return junctionEntry;
        }
        return detectionBuildDetectionPolygonOverlayEntry(detection, context, {
            includeLabel: false,
            enforceConfidence: false
        });
    }

    function detectionBuildOverlayEntriesForViewMode(viewMode, context) {
        if (viewMode === DETECTION_VIEW_MODE_RAW) {
            return Array.isArray(detectionRawResults?.detections)
                ? detectionRawResults.detections
                    .map(detection => detectionBuildDetectionPolygonOverlayEntry(detection, context, {
                        includeLabel: true,
                        enforceConfidence: true
                    }))
                    .filter(Boolean)
                : [];
        }
        if (viewMode === DETECTION_VIEW_MODE_FINAL) {
            return extractFireGetSharedFinalAnnotations().length
                ? extractFireGetSharedFinalAnnotations()
                    .map(annotation => detectionCreateAnnotationOverlayEntry(annotation))
                    .filter(Boolean)
                : [];
        }
        return Array.isArray(detectionAdjustedResults?.detections)
            ? detectionAdjustedResults.detections
                .map(detection => detectionBuildProcessedOverlayEntry(detection, context))
                .filter(Boolean)
                .sort((left, right) => {
                    const leftPriority = left?.annotationType === 'connect' ? 0 : 1;
                    const rightPriority = right?.annotationType === 'connect' ? 0 : 1;
                    return leftPriority - rightPriority;
                })
            : [];
    }

    function detectionShouldDrawOverlayEntry(entry) {
        if (!entry?.layerName) return true;
        return layerVisibility[entry.layerName] !== false;
    }

    function detectionDrawOverlayLabel(targetCtx, labelText, labelBounds, context, overlayStyle, labelMetrics) {
        if (!labelText || !labelBounds) return;
        const { fontSize, paddingX, paddingY, labelGap } = labelMetrics;
        const textWidth = targetCtx.measureText(labelText).width;
        const labelWidth = textWidth + (paddingX * 2);
        const labelHeight = fontSize + (paddingY * 2);
        const maxLabelX = Math.max(context.bounds.minX, context.bounds.maxX - labelWidth);
        const maxLabelY = Math.max(context.bounds.minY, context.bounds.maxY - labelHeight);
        const labelX = Math.max(context.bounds.minX, Math.min(labelBounds.minX, maxLabelX));
        let labelY = labelBounds.minY - labelHeight - labelGap;
        if (labelY < context.bounds.minY) {
            labelY = Math.min(maxLabelY, labelBounds.minY + labelGap);
        }
        labelY = Math.max(context.bounds.minY, labelY);

        targetCtx.fillStyle = overlayStyle.labelFill;
        targetCtx.fillRect(labelX, labelY, labelWidth, labelHeight);
        targetCtx.fillStyle = '#ffffff';
        targetCtx.fillText(labelText, labelX + paddingX, labelY + paddingY);
    }

    function extractFireColorWithAlpha(hexColor, alpha) {
        const hex = String(hexColor || '').replace('#', '');
        if (hex.length !== 6) return `rgba(15, 23, 42, ${alpha})`;
        const red = parseInt(hex.slice(0, 2), 16);
        const green = parseInt(hex.slice(2, 4), 16);
        const blue = parseInt(hex.slice(4, 6), 16);
        return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
    }

    function extractFireNormalizeBBox(value) {
        if (Array.isArray(value) && value.length >= 4) {
            const polygonBounds = detectionBoundsFromPointPairs(value);
            if (polygonBounds) {
                return {
                    minX: polygonBounds.minX,
                    minY: polygonBounds.minY,
                    maxX: polygonBounds.maxX,
                    maxY: polygonBounds.maxY
                };
            }
            const x0 = detectionSafeNumber(value[0]);
            const y0 = detectionSafeNumber(value[1]);
            const x1 = detectionSafeNumber(value[2]);
            const y1 = detectionSafeNumber(value[3]);
            if ([x0, y0, x1, y1].some(item => item === null)) return null;
            return { minX: Math.min(x0, x1), minY: Math.min(y0, y1), maxX: Math.max(x0, x1), maxY: Math.max(y0, y1) };
        }
        if (value && typeof value === 'object') {
            if ([value.minX, value.minY, value.maxX, value.maxY].every(item => detectionSafeNumber(item) !== null)) {
                return {
                    minX: Number(value.minX),
                    minY: Number(value.minY),
                    maxX: Number(value.maxX),
                    maxY: Number(value.maxY)
                };
            }
            const x = detectionSafeNumber(value.x);
            const y = detectionSafeNumber(value.y);
            const width = detectionSafeNumber(value.width);
            const height = detectionSafeNumber(value.height);
            if ([x, y, width, height].every(item => item !== null)) {
                return { minX: x, minY: y, maxX: x + width, maxY: y + height };
            }
        }
        return null;
    }

    function extractFireBboxToPolygon(bbox) {
        return [
            { x: bbox.minX, y: bbox.minY },
            { x: bbox.maxX, y: bbox.minY },
            { x: bbox.maxX, y: bbox.maxY },
            { x: bbox.minX, y: bbox.maxY }
        ];
    }

    function extractFireGetDrawContextBounds(entryBounds = null) {
        const sourceBounds = allShapesBounds || detectionOverlayContext?.bounds || entryBounds;
        if (!sourceBounds) {
            return entryBounds || { minX: 0, minY: 0, maxX: 1, maxY: 1, width: 1, height: 1 };
        }
        return {
            minX: Number(sourceBounds.minX),
            minY: Number(sourceBounds.minY),
            maxX: Number(sourceBounds.maxX),
            maxY: Number(sourceBounds.maxY),
            width: Number(sourceBounds.width || Math.max(1, sourceBounds.maxX - sourceBounds.minX)),
            height: Number(sourceBounds.height || Math.max(1, sourceBounds.maxY - sourceBounds.minY))
        };
    }

    function extractFireDrawBboxOverlay(targetCtx, bbox, color, labelText, options = {}) {
        if (!bbox) return;
        const zoomSafe = Math.max(zoom, 0.01);
        const polygon = extractFireBboxToPolygon(bbox);
        const entryBounds = detectionBoundsFromPointPairs(polygon);
        const context = { bounds: extractFireGetDrawContextBounds(entryBounds) };
        const overlayStyle = {
            fill: extractFireColorWithAlpha(color, options.fillAlpha ?? 0.12),
            stroke: color,
            labelFill: extractFireColorWithAlpha(color, 0.92)
        };

        targetCtx.fillStyle = overlayStyle.fill;
        targetCtx.strokeStyle = overlayStyle.stroke;
        targetCtx.lineWidth = (options.lineWidth || 1.8) / zoomSafe;
        targetCtx.setLineDash(options.dashed ? [5 / zoomSafe, 4 / zoomSafe] : []);
        detectionDrawWorldPolygonPath(targetCtx, polygon);
        targetCtx.fill();
        detectionDrawWorldPolygonPath(targetCtx, polygon);
        targetCtx.stroke();
        targetCtx.setLineDash([]);
        detectionDrawOverlayLabel(targetCtx, labelText, entryBounds, context, overlayStyle, {
            fontSize: (options.fontSize || 10) / zoomSafe,
            paddingX: 4 / zoomSafe,
            paddingY: 3 / zoomSafe,
            labelGap: 2 / zoomSafe
        });
    }

    function extractFireGetPanelSymbolItems() {
        return getExtractFireSymbolAnnotationsPayload()
            .map((annotation, index) => {
                const worldBbox = annotation?.world_bbox || annotation?.worldBBox;
                const bbox = extractFireNormalizeBBox(worldBbox || annotation?.bbox || annotation?.rect);
                if (!bbox) return null;
                return {
                    id: annotation.annotation_id || annotation.id || `panel:${index + 1}`,
                    shape_name: annotation.label_name || annotation.shape_name || annotation.name || 'Symbol',
                    bbox: [bbox.minX, bbox.minY, bbox.maxX, bbox.maxY],
                    source: 'panel'
                };
            })
            .filter(Boolean);
    }

    function extractFireDeduplicateSymbolItems(items) {
        const dedupedItems = [];
        const seenKeys = new Set();
        (Array.isArray(items) ? items : []).forEach((item, index) => {
            const bbox = extractFireNormalizeBBox(item?.bbox || item?.world_bbox || item?.worldBBox || item?.rect);
            if (!bbox) return;
            const key = [
                String(item?.shape_name || item?.label_name || 'symbol').trim().toLowerCase(),
                detectionRound(bbox.minX, 2),
                detectionRound(bbox.minY, 2),
                detectionRound(bbox.maxX, 2),
                detectionRound(bbox.maxY, 2)
            ].join('|');
            if (seenKeys.has(key)) return;
            seenKeys.add(key);
            dedupedItems.push({
                ...item,
                id: item?.id || item?.annotation_id || `symbol:${index + 1}`,
                bbox: [bbox.minX, bbox.minY, bbox.maxX, bbox.maxY]
            });
        });
        return dedupedItems;
    }

    function extractFireGetSelectedSymbolItems() {
        const apiItems = extractFireGetSymbolItemsFromResult(extractFireSymbolResults);
        const panelItems = extractFireGetPanelSymbolItems();
        if (extractFireSymbolSource === EXTRACT_FIRE_SYMBOL_SOURCE_PANEL) return panelItems;
        if (extractFireSymbolSource === EXTRACT_FIRE_SYMBOL_SOURCE_API) return apiItems;
        return extractFireDeduplicateSymbolItems([...panelItems, ...apiItems]);
    }

    function extractFireDrawTextOverlays(targetCtx) {
        if (!extractFireOverlayVisibility.text) return;
        extractFireGetTextItems().forEach(item => {
            const bbox = extractFireNormalizeBBox(item?.bbox);
            if (!bbox) return;
            const label = String(item?.text || '').trim().slice(0, 32) || 'text';
            extractFireDrawBboxOverlay(targetCtx, bbox, EXTRACT_FIRE_OVERLAY_COLORS.text, label, { dashed: true, fillAlpha: 0.08 });
        });
    }

    function extractFireDrawSymbolOverlays(targetCtx) {
        if (!extractFireOverlayVisibility.symbol) return;
        extractFireGetSelectedSymbolItems().forEach(item => {
            const bbox = extractFireNormalizeBBox(item?.bbox);
            if (!bbox) return;
            const label = String(item?.shape_name || item?.label_name || 'symbol').slice(0, 28);
            extractFireDrawBboxOverlay(targetCtx, bbox, EXTRACT_FIRE_OVERLAY_COLORS.symbol, label, { fillAlpha: 0.1 });
        });
    }

    function extractFireNormalizeVertices(vertices) {
        if (!Array.isArray(vertices)) return [];
        return vertices
            .map(point => {
                const pointX = detectionSafeNumber(point?.[0] ?? point?.x);
                const pointY = detectionSafeNumber(point?.[1] ?? point?.y);
                return pointX === null || pointY === null ? null : { x: pointX, y: pointY };
            })
            .filter(Boolean);
    }

    function extractFireDrawMergedObject(targetCtx, item) {
        const zoomSafe = Math.max(zoom, 0.01);
        const shapeName = String(item?.shape_name || item?.type || '').trim() || 'Object';
        const vertices = extractFireNormalizeVertices(item?.vertices);
        if (shapeName.toLowerCase() === 'line' && vertices.length >= 2) {
            targetCtx.save();
            targetCtx.strokeStyle = EXTRACT_FIRE_OVERLAY_COLORS.mergeLine;
            targetCtx.lineWidth = 2.4 / zoomSafe;
            targetCtx.setLineDash([]);
            targetCtx.beginPath();
            targetCtx.moveTo(vertices[0].x, vertices[0].y);
            for (let index = 1; index < vertices.length; index += 1) {
                targetCtx.lineTo(vertices[index].x, vertices[index].y);
            }
            targetCtx.stroke();
            targetCtx.restore();
            return;
        }
        if (vertices.length === 1) {
            const color = shapeName.toLowerCase().includes('tee') || shapeName.toLowerCase().includes('elbow') || shapeName.toLowerCase().includes('cross')
                ? EXTRACT_FIRE_OVERLAY_COLORS.mergeNode
                : EXTRACT_FIRE_OVERLAY_COLORS.mergeSymbol;
            detectionDrawWorldPointMarker(targetCtx, vertices[0], color, Math.max(4 / zoomSafe, 1.2 / zoomSafe));
            const pointBounds = detectionBoundsFromPointPairs(vertices);
            detectionDrawOverlayLabel(targetCtx, shapeName, pointBounds, { bounds: extractFireGetDrawContextBounds(pointBounds) }, {
                labelFill: extractFireColorWithAlpha(color, 0.92)
            }, {
                fontSize: 10 / zoomSafe,
                paddingX: 4 / zoomSafe,
                paddingY: 3 / zoomSafe,
                labelGap: 2 / zoomSafe
            });
            return;
        }
        const bbox = extractFireNormalizeBBox(item?.bbox);
        if (bbox) {
            extractFireDrawBboxOverlay(targetCtx, bbox, EXTRACT_FIRE_OVERLAY_COLORS.mergeSymbol, shapeName, { lineWidth: 2.2, fillAlpha: 0.1 });
        }
    }

    function extractFireDrawMergeOverlays(targetCtx) {
        if (!extractFireOverlayVisibility.merge || !Array.isArray(extractFireMergeResults?.json_objects)) return;
        extractFireMergeResults.json_objects.forEach(item => extractFireDrawMergedObject(targetCtx, item));
    }

    function drawDetectionExtractOverlays(targetCtx) {
        const activeResult = detectionGetResultForViewMode();
        const isAnnotationEditingActive = typeof annotationMode !== 'undefined' && Boolean(annotationMode);
        const hasPendingManualPoint = typeof pendingConnectPoint !== 'undefined' && Boolean(pendingConnectPoint);
        const hasHoveredManualSnap = typeof hoveredSnapPoint !== 'undefined' && Boolean(hoveredSnapPoint);
        const shouldUseManualOverlayForFinalView = detectionResultViewMode === DETECTION_VIEW_MODE_FINAL
            && extractFireOverlayVisibility.line
            && (
                isAnnotationEditingActive
                || hasPendingManualPoint
                || hasHoveredManualSnap
                || (typeof hasSuggestedConnectAnnotations === 'function' && hasSuggestedConnectAnnotations())
            );
        targetCtx.save();
        targetCtx.lineJoin = 'round';
        targetCtx.textBaseline = 'top';

        if (activeResult && extractFireOverlayVisibility.line && !shouldUseManualOverlayForFinalView) {
            const contextSource = detectionResultViewMode === DETECTION_VIEW_MODE_FINAL
                ? (detectionAdjustedResults || detectionRawResults || activeResult)
                : activeResult;
            const context = detectionBuildOverlayRenderContext(contextSource);
            if (context) {
                const overlayEntries = detectionBuildOverlayEntriesForViewMode(detectionResultViewMode, context);
                const zoomSafe = Math.max(zoom, 0.01);
                const fontSize = 11 / zoomSafe;
                const paddingX = 4 / zoomSafe;
                const paddingY = 3 / zoomSafe;
                const labelGap = 2 / zoomSafe;
                const pointRadiusWorld = Math.max(3 / zoomSafe, 1 / zoomSafe);
                targetCtx.font = `700 ${fontSize}px Arial`;

                overlayEntries.forEach(entry => {
                    if (!detectionShouldDrawOverlayEntry(entry)) return;
                    const overlayStyle = detectionGetOverlayStyle(entry);
                    const isProcessedView = detectionResultViewMode === DETECTION_VIEW_MODE_PROCESSED;
                    const polygonStrokeWidth = isProcessedView ? (1.85 / zoomSafe) : (2 / zoomSafe);

                    targetCtx.fillStyle = overlayStyle.fill;
                    targetCtx.strokeStyle = overlayStyle.stroke;
                    targetCtx.lineWidth = polygonStrokeWidth;
                    targetCtx.setLineDash([]);
                    detectionDrawWorldPolygonPath(targetCtx, entry.polygon);
                    targetCtx.fill();
                    detectionDrawWorldPolygonPath(targetCtx, entry.polygon);
                    targetCtx.stroke();

                    (entry.segments || []).forEach(segment => {
                        if (!Array.isArray(segment) || segment.length < 2) return;
                        targetCtx.lineWidth = polygonStrokeWidth;
                        targetCtx.beginPath();
                        targetCtx.moveTo(segment[0].x, segment[0].y);
                        targetCtx.lineTo(segment[1].x, segment[1].y);
                        targetCtx.stroke();
                    });

                    (entry.points || []).forEach(point => {
                        detectionDrawWorldPointMarker(targetCtx, point, overlayStyle.point, pointRadiusWorld * (entry.pointScale || 1));
                    });

                    detectionDrawOverlayLabel(targetCtx, entry.labelText, entry.labelBounds, context, overlayStyle, {
                        fontSize,
                        paddingX,
                        paddingY,
                        labelGap
                    });
                });
            }
        }

        targetCtx.font = `700 ${10 / Math.max(zoom, 0.01)}px Arial`;
        extractFireDrawTextOverlays(targetCtx);
        extractFireDrawSymbolOverlays(targetCtx);
        extractFireDrawMergeOverlays(targetCtx);

        targetCtx.restore();
    }

    function extractFireGetSharedFinalAnnotations() {
        const panelAnnotations = getExtractFireManualAnnotationPayload();
        if (panelAnnotations.length) {
            return panelAnnotations;
        }
        return Array.isArray(detectionAutoAcceptResults?.manual_annotations)
            ? detectionAutoAcceptResults.manual_annotations
            : [];
    }

    function applyDetectionResultsToLayers(adjustedDetectionJson, exportContext) {
        clearDetectionVisualization({ refresh: false, preserveResults: true });
        const imageSize = adjustedDetectionJson?.image_size || {};
        const context = {
            ...exportContext,
            imageWidth: Number(imageSize.width || exportContext.imageWidth),
            imageHeight: Number(imageSize.height || exportContext.imageHeight)
        };
        context.scaleX = context.imageWidth / context.bounds.width;
        context.scaleY = context.imageHeight / context.bounds.height;

        const groups = new Map();
        (adjustedDetectionJson.detections || []).forEach((detection, index) => {
            const shape = detectionCreateOverlayShape(detection, context, index);
            if (!shape) return;
            if (!groups.has(shape.layer)) {
                groups.set(shape.layer, []);
            }
            groups.get(shape.layer).push(shape);
        });

        detectionLayerNames = Array.from(groups.keys());
        groups.forEach((shapes, layerName) => {
            layerIndex[layerName] = shapes;
            layerVisibility[layerName] = true;
            totalCommands[layerName] = shapes.reduce((total, shape) => total + (shape.items?.length || 0), 0);
            if (!sortedLayerKeys.includes(layerName)) {
                sortedLayerKeys.push(layerName);
            }
            shapes.forEach(shape => {
                allShapesSorted.push(shape);
                allShapesBounds = mergeBounds(allShapesBounds, getBoundsFromBbox(shape.bbox));
                _perLayerBounds[layerName] = mergeBounds(_perLayerBounds[layerName], getBoundsFromBbox(shape.bbox));
            });
        });

        sortShapesForDraw(allShapesSorted);
        if (typeof rebuildQuadtree === 'function') {
            rebuildQuadtree();
        }
        if (typeof invalidateShapeRasterCache === 'function') {
            invalidateShapeRasterCache();
            scheduleShapeRasterCacheBuild();
        }
        if (typeof invalidateSeqnoHoverIndex === 'function') {
            invalidateSeqnoHoverIndex();
        }
        updateLayerList();
        scheduleDraw();
        updateDetectionExtractUI();
    }

    function detectionAreBoundsCompatible(cachedBounds, targetBounds) {
        if (!cachedBounds || !targetBounds) return false;
        return Math.abs(Number(cachedBounds.minX) - Number(targetBounds.minX)) <= DETECTION_CACHE_BOUNDS_EPSILON
            && Math.abs(Number(cachedBounds.minY) - Number(targetBounds.minY)) <= DETECTION_CACHE_BOUNDS_EPSILON
            && Math.abs(Number(cachedBounds.maxX) - Number(targetBounds.maxX)) <= DETECTION_CACHE_BOUNDS_EPSILON
            && Math.abs(Number(cachedBounds.maxY) - Number(targetBounds.maxY)) <= DETECTION_CACHE_BOUNDS_EPSILON;
    }

    function detectionCanUseRasterPreview(rasterPreview, bounds, scale) {
        return Boolean(
            rasterPreview?.canvas
            && rasterPreview?.bounds
            && Number(rasterPreview.scale) + DETECTION_CACHE_SCALE_EPSILON >= scale
            && detectionAreBoundsCompatible(rasterPreview.bounds, bounds)
        );
    }

    function detectionDrawRasterPreviewToExportCanvas(exportCtx, rasterPreview, bounds, scale, imageWidth, imageHeight) {
        const sourceScale = Number(rasterPreview.scale) || scale;
        const sourceX = (bounds.minX - rasterPreview.bounds.minX) * sourceScale;
        const sourceY = (bounds.minY - rasterPreview.bounds.minY) * sourceScale;
        const sourceWidth = bounds.width * sourceScale;
        const sourceHeight = bounds.height * sourceScale;
        exportCtx.drawImage(
            rasterPreview.canvas,
            sourceX,
            sourceY,
            sourceWidth,
            sourceHeight,
            0,
            0,
            imageWidth,
            imageHeight
        );
    }

    async function detectionGetCompatibleRasterPreview(bounds, scale) {
        if (detectionCanUseRasterPreview(shapeRasterCache, bounds, scale)) {
            return shapeRasterCache;
        }

        if (typeof ensureShapeRasterCache !== 'function') {
            return null;
        }

        const rasterPreview = await ensureShapeRasterCache(scale);
        return detectionCanUseRasterPreview(rasterPreview, bounds, scale) ? rasterPreview : null;
    }

    async function createDetectionExtractImagePayload() {
        const scale = Number(CONFIG.MANUAL_LABEL_SCALE) || 3;
        const bounds = await getExportBounds(scale);
        if (!bounds) {
            throw new Error('Khong xac dinh duoc vung export.');
        }

        const cacheKey = detectionBuildImageCacheKey(bounds, scale);
        if (detectionExtractImageCache?.key === cacheKey) {
            return { ...detectionExtractImageCache.payload, fromCache: true };
        }

        const imageWidth = Math.max(1, Math.round(bounds.width * scale));
        const imageHeight = Math.max(1, Math.round(bounds.height * scale));
        const { canvas: exportCanvas, ctx: exportCtx } = createCanvas(imageWidth, imageHeight);
        exportCtx.fillStyle = '#ffffff';
        exportCtx.fillRect(0, 0, imageWidth, imageHeight);

        const rasterPreview = await detectionGetCompatibleRasterPreview(bounds, scale);
        if (rasterPreview) {
            detectionDrawRasterPreviewToExportCanvas(exportCtx, rasterPreview, bounds, scale, imageWidth, imageHeight);
        } else {
            await drawVisibleDocumentRaster(exportCtx, bounds, scale);
            const includeText = layerVisibility?.svg_text !== false;
            const includeGraphic = layerVisibility?.svg_graphic !== false;
            if ((includeText || includeGraphic) && svgData && typeof drawSvgLayersToRasterContext === 'function') {
                await drawSvgLayersToRasterContext(exportCtx, {
                    svgSource: svgData,
                    bounds,
                    scale,
                    includeText,
                    includeGraphic
                });
            }
        }

        const payload = {
            imageB64: canvasToBase64(exportCanvas, 'image/png'),
            imageName: `${getCurrentExportBaseName()}_p${currentPageNum || 1}_layers_3x.png`,
            bounds,
            scale,
            imageWidth,
            imageHeight,
            fromRasterCache: Boolean(rasterPreview)
        };
        detectionExtractImageCache = { key: cacheKey, payload };
        return { ...payload };
    }

    function detectionCollectManualConnectSpecs(adjustedDetectionJson) {
        return (adjustedDetectionJson?.detections || [])
            .filter(detection => detectionIsConnectClass(detection?.class_name) && detection?.postprocess?.validated)
            .map(detection => {
                const postprocess = detection.postprocess || {};
                return {
                    layerName: postprocess.layer_name,
                    points: postprocess.manual_points,
                    lineKeys: postprocess.matched_line_keys,
                    segments: postprocess.manual_segments
                };
            })
            .filter(connectSpec => connectSpec.layerName && Array.isArray(connectSpec.points) && connectSpec.points.length >= 2);
    }

    async function detectionPromoteConnectsToManualPanel(adjustedDetectionJson) {
        const connectSpecs = detectionCollectManualConnectSpecs(adjustedDetectionJson);
        if (!connectSpecs.length || typeof addDetectedConnectAnnotationsToManualPanel !== 'function') {
            return {
                addedConnectCount: 0,
                addedJunctionCount: 0,
                suggestionAcceptedConnectCount: 0,
                suggestionAcceptedJunctionCount: 0
            };
        }
        return addDetectedConnectAnnotationsToManualPanel(connectSpecs, {
            source: 'detection',
            autoAcceptSuggestions: true,
            maxSuggestionRounds: 1,
            fullRecheckExistingConnects: true,
            recheckFromAcceptedSuggestions: true,
            requestNextSuggestions: false,
            suppressUi: true,
            seedQueueAutoAccept: true,
            openPanel: false
        });
    }

    function detectionCloneManualAnnotationForRequest(annotation) {
        if (!annotation || typeof annotation !== 'object') return null;
        if (typeof cloneAnnotation === 'function') {
            return cloneAnnotation(annotation);
        }

        const layerName = typeof annotation.layerName === 'string'
            ? annotation.layerName
            : (typeof annotation.layer_name === 'string' ? annotation.layer_name : '');
        if (!layerName || !annotation.type) return null;

        const points = (Array.isArray(annotation.points) ? annotation.points : [])
            .map(point => {
                const pointX = Number(point?.x);
                const pointY = Number(point?.y);
                if (!Number.isFinite(pointX) || !Number.isFinite(pointY)) return null;
                return {
                    x: pointX,
                    y: pointY,
                    layerName: typeof point?.layerName === 'string' ? point.layerName : layerName
                };
            })
            .filter(Boolean);
        if ((annotation.type === 'connect' && points.length < 2) || (annotation.type === 'junction' && !points.length)) {
            return null;
        }

        const segments = (Array.isArray(annotation.segments) ? annotation.segments : [])
            .filter(segment => Array.isArray(segment) && segment.length >= 2)
            .map(segment => segment.slice(0, 2).map(point => ({
                x: Number(point?.x),
                y: Number(point?.y),
                layerName: typeof point?.layerName === 'string' ? point.layerName : layerName
            })))
            .filter(segment => segment.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));

        return {
            id: annotation.id ?? null,
            type: annotation.type,
            layerName,
            source: typeof annotation.source === 'string' && annotation.source ? annotation.source : 'manual',
            autoManaged: Boolean(annotation.autoManaged),
            points,
            lineKeys: (Array.isArray(annotation.lineKeys) ? annotation.lineKeys : []).map(lineKey => String(lineKey)).filter(Boolean),
            segments
        };
    }

    async function buildDetectionRequestPayload() {
        let gzipData = currentPageNum
            ? (getPageGzipCacheValue(cachedPages, currentPageNum, { touch: false })
                || getPageGzipCacheValue(stagedCachedPages, currentPageNum, { touch: false }))
            : null;

        if (!gzipData && typeof ensurePipelineCacheForCurrentDocument === 'function') {
            gzipData = await ensurePipelineCacheForCurrentDocument();
        }
        if (!gzipData) {
            throw new Error('Khong co gzip_data cua trang hien tai de gui len backend.');
        }

        const visibleLayers = typeof getVisibleRenderableLayers === 'function'
            ? getVisibleRenderableLayers()
            : Object.keys(layerVisibility || {}).filter(layerName => layerVisibility?.[layerName]);
        const manualAnnotationPayload = Array.isArray(manualAnnotations)
            ? manualAnnotations.map(detectionCloneManualAnnotationForRequest).filter(Boolean)
            : [];

        const pageNum = Number.isInteger(Number(currentPageNum)) && Number(currentPageNum) >= 1 ? Number(currentPageNum) : 1;
        const pdfName = (currentPdfFile && currentPdfFile.name)
            || (currentJsonSourceFile && (currentJsonSourceFile.name || String(currentJsonSourceFile)))
            || 'visual_layers';
        const preferServerPageCache = Boolean(currentPdfFile && pageNum);
        const documentKey = typeof getCurrentMainLayerDocumentKey === 'function'
            ? getCurrentMainLayerDocumentKey()
            : pdfName;

        return {
            payload: {
                gzip_data: preferServerPageCache ? '' : gzipData,
                pdf_name: pdfName,
                page_num: pageNum,
                document_key: documentKey,
                prefer_server_page_cache: preferServerPageCache,
                visible_layers: visibleLayers,
                layer_visibility: { ...(layerVisibility || {}) },
                manual_annotations: manualAnnotationPayload,
                use_sahi: true
            },
            fallbackGzipData: gzipData,
            preferServerPageCache
        };
    }

    async function buildExtractFirePageRequestPayload(options = {}) {
        let gzipData = currentPageNum
            ? (getPageGzipCacheValue(cachedPages, currentPageNum, { touch: false })
                || getPageGzipCacheValue(stagedCachedPages, currentPageNum, { touch: false }))
            : null;

        if (!gzipData && typeof ensurePipelineCacheForCurrentDocument === 'function') {
            gzipData = await ensurePipelineCacheForCurrentDocument();
        }
        if (!gzipData) {
            throw new Error('Khong co gzip_data cua trang hien tai de gui len backend.');
        }

        const pageNum = Number.isInteger(Number(currentPageNum)) && Number(currentPageNum) >= 1 ? Number(currentPageNum) : 1;
        const pdfName = (currentPdfFile && currentPdfFile.name)
            || (currentJsonSourceFile && (currentJsonSourceFile.name || String(currentJsonSourceFile)))
            || 'visual_layers';
        const preferServerPageCache = Boolean(currentPdfFile && pageNum);
        const documentKey = typeof getCurrentMainLayerDocumentKey === 'function'
            ? getCurrentMainLayerDocumentKey()
            : pdfName;

        let uploadSessionId = null;
        if (options.includePdf) {
            uploadSessionId = currentPdfUploadSession?.sessionId || null;
        }
        if (options.includePdf && currentPdfFile && typeof ensurePdfUploadSession === 'function') {
            const session = await ensurePdfUploadSession(currentPdfFile);
            uploadSessionId = session?.sessionId || uploadSessionId;
        }

        return {
            payload: {
                gzip_data: preferServerPageCache ? '' : gzipData,
                pdf_name: pdfName,
                page_num: pageNum,
                document_key: documentKey,
                prefer_server_page_cache: preferServerPageCache,
                upload_session_id: uploadSessionId
            },
            fallbackGzipData: gzipData,
            preferServerPageCache
        };
    }

    async function callExtractFireBackend(routeName, requestBundle, payloadPatch = {}, options = {}) {
        const callBackend = async payload => {
            const response = await fetch(`${ENV.API_BASE_URL}/${routeName}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: options.signal
            });
            if (!response.ok) {
                throw new Error(await parseHttpErrorResponse(response));
            }
            return response.json();
        };

        const requestPayload = { ...requestBundle.payload, ...payloadPatch };
        try {
            return await callBackend(requestPayload);
        } catch (error) {
            if (!requestBundle.preferServerPageCache || !requestBundle.fallbackGzipData || requestPayload.gzip_data) {
                throw error;
            }
            return callBackend({
                ...requestPayload,
                gzip_data: requestBundle.fallbackGzipData,
                prefer_server_page_cache: false
            });
        }
    }

    function extractFireShouldRetryTextWithPdfUpload(error) {
        const message = String(error?.message || error || '').toLowerCase();
        return message.includes('pdf not found')
            || message.includes('upload once')
            || message.includes('send upload_session_id')
            || message.includes('pdf_path is required');
    }

    function getExtractFireSymbolAnnotationsPayload() {
        if (typeof buildSymbolAnnotationPagePayload !== 'function') return [];
        const payload = buildSymbolAnnotationPagePayload();
        return Array.isArray(payload?.annotations) ? payload.annotations : [];
    }

    function getExtractFireManualAnnotationPayload() {
        return Array.isArray(manualAnnotations)
            ? manualAnnotations.map(detectionCloneManualAnnotationForRequest).filter(Boolean)
            : [];
    }

    function getExtractFireTextSeqnosForMerge() {
        const seqnos = new Set();
        const addSeqno = value => {
            const numericValue = Number(value);
            if (Number.isFinite(numericValue)) {
                seqnos.add(Math.trunc(numericValue));
            }
        };
        const addSeqnoList = values => {
            if (Array.isArray(values)) {
                values.forEach(addSeqno);
            }
        };

        const textResult = extractFireTextResults || {};
        extractFireGetTextItems().forEach(item => addSeqnoList(item?.seqnos || item?.list_seqno));
        if (Array.isArray(textResult.list_seqno)) {
            textResult.list_seqno.forEach(addSeqnoList);
        }

        const mergedSource = textResult.sources?.merged;
        if (mergedSource && Array.isArray(mergedSource.list_seqno)) {
            mergedSource.list_seqno.forEach(addSeqnoList);
        }
        return seqnos;
    }

    function getExtractFireTextSeqnoShapePayload() {
        const seqnos = getExtractFireTextSeqnosForMerge();
        const sourceShapes = Array.isArray(jsonShapes) ? jsonShapes : [];
        if (!seqnos.size || !sourceShapes.length) return [];

        return sourceShapes
            .map(shape => {
                const seqnoValue = Number(shape?.seqno);
                if (!Number.isFinite(seqnoValue) || !seqnos.has(Math.trunc(seqnoValue))) return null;
                const items = Array.isArray(shape?.items_bl)
                    ? shape.items_bl
                    : (Array.isArray(shape?.items) ? shape.items : []);
                const drawingItems = items.filter(item => Array.isArray(item) && (item[0] === 'l' || item[0] === 'c'));
                if (!drawingItems.length) return null;
                return {
                    seqno: shape.seqno,
                    items: drawingItems
                };
            })
            .filter(Boolean);
    }

    function extractFireBuildAnnotationSignatureEntry(annotation) {
        return {
            id: annotation?.id ?? null,
            type: annotation?.type || '',
            layerName: annotation?.layerName || '',
            autoManaged: Boolean(annotation?.autoManaged),
            source: annotation?.source || '',
            points: Array.isArray(annotation?.points)
                ? annotation.points.map(point => [detectionRound(point?.x ?? 0, 3), detectionRound(point?.y ?? 0, 3), point?.layerName || ''])
                : [],
            lineKeys: Array.isArray(annotation?.lineKeys) ? annotation.lineKeys.map(String).sort() : [],
            segments: Array.isArray(annotation?.segments)
                ? annotation.segments.map(segment => Array.isArray(segment)
                    ? segment.slice(0, 2).map(point => [detectionRound(point?.x ?? 0, 3), detectionRound(point?.y ?? 0, 3), point?.layerName || ''])
                    : []
                )
                : []
        };
    }

    function extractFireGetManualAnnotationSignature() {
        try {
            return JSON.stringify(getExtractFireManualAnnotationPayload().map(extractFireBuildAnnotationSignatureEntry));
        } catch (error) {
            return '';
        }
    }

    function extractFireGetSymbolAnnotationSignature() {
        try {
            return JSON.stringify(getExtractFireSymbolAnnotationsPayload().map(annotation => {
                const bbox = extractFireNormalizeBBox(annotation?.world_bbox || annotation?.worldBBox || annotation?.bbox || annotation?.rect);
                return {
                    id: annotation?.annotation_id || annotation?.id || null,
                    labelId: annotation?.label_id || annotation?.labelId || null,
                    labelName: annotation?.label_name || annotation?.labelName || '',
                    bbox: bbox
                        ? [
                            detectionRound(bbox.minX, 3),
                            detectionRound(bbox.minY, 3),
                            detectionRound(bbox.maxX, 3),
                            detectionRound(bbox.maxY, 3)
                        ]
                        : null
                };
            }));
        } catch (error) {
            return '';
        }
    }

    function extractFireSyncEditableStateSignatures() {
        extractFireLastManualAnnotationSignature = extractFireGetManualAnnotationSignature();
        extractFireLastSymbolAnnotationSignature = extractFireGetSymbolAnnotationSignature();
    }

    function refreshDetectionExtractFromEditableState() {
        const nextManualSignature = extractFireGetManualAnnotationSignature();
        const nextSymbolSignature = extractFireGetSymbolAnnotationSignature();
        const didManualChange = nextManualSignature !== extractFireLastManualAnnotationSignature;
        const didSymbolChange = nextSymbolSignature !== extractFireLastSymbolAnnotationSignature;

        extractFireLastManualAnnotationSignature = nextManualSignature;
        extractFireLastSymbolAnnotationSignature = nextSymbolSignature;

        if (didManualChange || didSymbolChange) {
            extractFireMergeResults = null;
        }

        updateDetectionExtractUI();
        if ((didManualChange || didSymbolChange) && typeof scheduleDraw === 'function') {
            scheduleDraw();
        }
    }

    function handleDetectionExtractDocumentLoaded() {
        const nextPageKey = extractFireGetPageKey();
        const didPageChange = Boolean(nextPageKey && extractFireStagePageKey && nextPageKey !== extractFireStagePageKey);
        const hasPageContext = Boolean(nextPageKey);

        if (!hasPageContext || didPageChange) {
            cancelDetectionExtractJobs({ reason: 'page-changed', keepStatus: true });
        }

        if (!hasPageContext || didPageChange) {
            extractFireLineResults = null;
            extractFireTextResults = null;
            extractFireSymbolResults = null;
            extractFireMergeResults = null;
        }

        extractFireStagePageKey = nextPageKey;
        extractFireSyncEditableStateSignatures();
        updateDetectionExtractUI();
        if (typeof scheduleDraw === 'function') {
            scheduleDraw();
        }
    }

    function isDetectionExtractManualEditingAllowed() {
        return detectionResultViewMode === DETECTION_VIEW_MODE_FINAL;
    }

    function getExtractFireLineResultPayload() {
        const panelAnnotations = getExtractFireManualAnnotationPayload();
        const finalAnnotations = extractFireGetSharedFinalAnnotations();
        if (extractFireLineSource === EXTRACT_FIRE_LINE_SOURCE_PANEL) {
            const panelDetections = panelAnnotations
                .map((annotation, index) => detectionAnnotationToLineDetection(annotation, index))
                .filter(Boolean);
            return {
                status: panelDetections.length ? 'ok' : 'empty',
                backend_owned: false,
                package: 'API.Extract_FIRE',
                detections: panelDetections,
                num_detections: panelDetections.length,
                summary: {
                    source: 'manual_labels_panel',
                    line_detection_count: panelDetections.length
                }
            };
        }
        if (detectionIsCompactLineResult(extractFireLineResults)) {
            const compactDetections = finalAnnotations.length
                ? finalAnnotations.map((annotation, index) => detectionAnnotationToLineDetection(annotation, index)).filter(Boolean)
                : detectionClone(extractFireLineResults.detections || []);
            return {
                ...detectionClone(extractFireLineResults),
                detections: compactDetections,
                num_detections: compactDetections.length
            };
        }
        const finalDetections = finalAnnotations
            .map((annotation, index) => detectionAnnotationToLineDetection(annotation, index))
            .filter(Boolean);
        return {
            status: finalDetections.length ? 'ok' : 'empty',
            backend_owned: true,
            package: 'API.Extract_FIRE',
            detections: finalDetections,
            num_detections: finalDetections.length,
            summary: {
                source: 'extract_final',
                line_detection_count: finalDetections.length
            }
        };
    }

    function getExtractFireSymbolResultForMerge() {
        if (extractFireSymbolSource === EXTRACT_FIRE_SYMBOL_SOURCE_PANEL) {
            return {};
        }
        return extractFireSymbolResults || {};
    }

    function getExtractFireSymbolAnnotationsForMerge() {
        if (extractFireSymbolSource === EXTRACT_FIRE_SYMBOL_SOURCE_API) {
            return [];
        }
        return getExtractFireSymbolAnnotationsPayload();
    }

    function setExtractFireOverlayVisibility(key, value) {
        if (!Object.prototype.hasOwnProperty.call(extractFireOverlayVisibility, key)) return;
        const nextValue = Boolean(value);
        extractFireOverlayVisibility[key] = nextValue;
        if (!nextValue && key === 'line') {
            extractFireHandleLineOverlayDisabled();
        }
        if (!nextValue && key === 'symbol') {
            extractFireHandleSymbolOverlayDisabled();
        }
        extractFireHandleLinkedPanelForOverlay(key, nextValue);
        updateDetectionExtractUI();
        if (typeof scheduleDraw === 'function') scheduleDraw();
    }

    function setExtractFireLineSource(source) {
        if (source !== EXTRACT_FIRE_LINE_SOURCE_FINAL && source !== EXTRACT_FIRE_LINE_SOURCE_PANEL) return;
        extractFireLineSource = source;
        extractFireMergeResults = null;
        updateDetectionExtractUI();
        if (typeof scheduleDraw === 'function') scheduleDraw();
    }

    function setExtractFireSymbolSource(source) {
        if (![EXTRACT_FIRE_SYMBOL_SOURCE_PANEL, EXTRACT_FIRE_SYMBOL_SOURCE_API, EXTRACT_FIRE_SYMBOL_SOURCE_BOTH].includes(source)) return;
        extractFireSymbolSource = source;
        extractFireMergeResults = null;
        updateDetectionExtractUI();
        if (typeof scheduleDraw === 'function') scheduleDraw();
    }

    function createManualAnnotationFromExtractFinal(annotation) {
        const payload = detectionCloneManualAnnotationForRequest(annotation);
        if (!payload) return null;
        manualAnnotationId += 1;
        return {
            ...payload,
            id: manualAnnotationId,
            source: 'extract-final',
            autoManaged: Boolean(payload.autoManaged)
        };
    }

    function promoteExtractFinalLinesToManualPanel() {
        const panelAnnotations = getExtractFireManualAnnotationPayload();
        const finalAnnotations = extractFireGetSharedFinalAnnotations();
        if (!finalAnnotations.length) {
            setDetectionExtractStatus('Chua co line final de dua sang Labels.', 'error');
            return;
        }
        if (panelAnnotations.length) {
            if (typeof applyManualLabelPanelState === 'function') {
                applyManualLabelPanelState(false);
            }
            setDetectionExtractStatus('Line final dang dung chung voi panel Labels. Hay sua truc tiep trong Labels roi bam Merge.', 'success');
            updateDetectionExtractUI();
            if (typeof scheduleDraw === 'function') scheduleDraw();
            return;
        }
        const normalizedAnnotations = finalAnnotations
            .map(createManualAnnotationFromExtractFinal)
            .filter(Boolean);
        if (!normalizedAnnotations.length) {
            setDetectionExtractStatus('Line final khong co annotation hop le de chinh sua.', 'error');
            return;
        }

        const addedAnnotations = typeof addAnnotations === 'function'
            ? addAnnotations(normalizedAnnotations, { record: true, updateUi: true })
            : [];
        if (typeof applyManualLabelPanelState === 'function') {
            applyManualLabelPanelState(false);
        }
        extractFireLineSource = EXTRACT_FIRE_LINE_SOURCE_PANEL;
        extractFireMergeResults = null;
        const addedCount = Array.isArray(addedAnnotations) ? addedAnnotations.length : normalizedAnnotations.length;
        setDetectionExtractStatus(`Da dua ${addedCount} line final sang Labels. Hay sua trong panel Labels roi bam Merge.`, addedCount ? 'success' : 'info');
        updateDetectionExtractUI();
        if (typeof scheduleDraw === 'function') scheduleDraw();
    }

    function extractFireEnsureImportedSymbolLabel() {
        if (typeof addSymbolLabel !== 'function') return null;
        return addSymbolLabel(EXTRACT_FIRE_IMPORTED_SYMBOL_LABEL_NAME, {
            silent: true,
            color: EXTRACT_FIRE_IMPORTED_SYMBOL_COLOR,
            persist: false
        });
    }

    function extractFireImportApiSymbolsToPanel(symbolResult, options = {}) {
        const persistedDocumentSummary = symbolResult?.persisted_document_summary;
        const persistedPagePayload = symbolResult?.persisted_page_payload;
        if (persistedDocumentSummary && typeof cacheSymbolAnnotationDocumentSummaryPayload === 'function') {
            cacheSymbolAnnotationDocumentSummaryPayload(persistedDocumentSummary);
        }
        if (persistedPagePayload && typeof applyLoadedSymbolAnnotationPayload === 'function' && options.preferPersistedPayload !== false) {
            const previousCount = extractFireGetPanelSymbolCount();
            applyLoadedSymbolAnnotationPayload(persistedPagePayload, { dirty: false });
            return {
                label: extractFireEnsureImportedSymbolLabel(),
                addedCount: Math.max(0, extractFireGetPanelSymbolCount() - previousCount),
                syncedCount: extractFireGetPanelSymbolCount(),
                persisted: true
            };
        }

        const label = extractFireEnsureImportedSymbolLabel();
        const apiItems = extractFireGetSymbolItemsFromResult(symbolResult);
        if (!label) {
            return { label: null, addedCount: 0 };
        }
        if (!apiItems.length) {
            return { label, addedCount: 0, syncedCount: extractFireGetPanelSymbolCount(), persisted: false };
        }
        if (typeof createSymbolAnnotation !== 'function' || typeof mergeSymbolAnnotations !== 'function') {
            return { label, addedCount: 0, syncedCount: extractFireGetPanelSymbolCount(), persisted: false };
        }

        const incomingAnnotations = apiItems
            .map(item => {
                const bbox = extractFireNormalizeBBox(item?.bbox || item?.world_bbox || item?.worldBBox || item?.rect);
                if (!bbox) return null;
                const rect = typeof normalizeWorldRect === 'function'
                    ? normalizeWorldRect({
                        x: bbox.minX,
                        y: bbox.minY,
                        width: bbox.maxX - bbox.minX,
                        height: bbox.maxY - bbox.minY
                    })
                    : {
                        x: bbox.minX,
                        y: bbox.minY,
                        width: bbox.maxX - bbox.minX,
                        height: bbox.maxY - bbox.minY
                    };
                if (!rect || rect.width <= 0 || rect.height <= 0) return null;
                return createSymbolAnnotation(label, rect, {
                    source: item?.source || 'extract_fire_api'
                });
            })
            .filter(Boolean);

        if (!incomingAnnotations.length) {
            return { label, addedCount: 0, syncedCount: extractFireGetPanelSymbolCount(), persisted: false };
        }

        const addedCount = mergeSymbolAnnotations(incomingAnnotations);
        return {
            label,
            addedCount,
            syncedCount: extractFireGetPanelSymbolCount(),
            persisted: false
        };
    }

    function extractFireRebuildTextResultPayload(itemsOverride = null) {
        const items = Array.isArray(itemsOverride)
            ? itemsOverride.filter(item => item && typeof item === 'object')
            : extractFireGetTextItems();
        extractFireSetTextItems(items);
        extractFireBindStageResultsToCurrentPage();
    }

    function extractFireFindTextItemAtPoint(worldX, worldY) {
        const items = extractFireGetTextItems();
        if (!extractFireOverlayVisibility.text || !items.length) {
            return null;
        }
        const candidates = items
            .map((item, index) => {
                const bbox = extractFireNormalizeBBox(item?.bbox);
                if (!bbox) return null;
                if (worldX < bbox.minX || worldX > bbox.maxX || worldY < bbox.minY || worldY > bbox.maxY) {
                    return null;
                }
                return {
                    item,
                    index,
                    items,
                    bbox,
                    area: Math.max((bbox.maxX - bbox.minX) * (bbox.maxY - bbox.minY), 0)
                };
            })
            .filter(Boolean)
            .sort((left, right) => left.area - right.area || left.index - right.index);
        return candidates[0] || null;
    }

    function handleDetectionExtractCanvasClick(worldX, worldY) {
        const hit = extractFireFindTextItemAtPoint(worldX, worldY);
        if (!hit) return false;

        const currentText = String(hit.item?.text || '').trim();
        const nextText = window.prompt('Sua text. De trong de xoa bbox text nay. Cancel de bo qua.', currentText);
        if (nextText === null) {
            return true;
        }

        if (!String(nextText).trim()) {
            const nextItems = hit.items.slice();
            nextItems.splice(hit.index, 1);
            extractFireRebuildTextResultPayload(nextItems);
            extractFireMergeResults = null;
            setDetectionExtractStatus('Da xoa 1 bbox text khoi ket qua extract.', 'success');
        } else {
            const nextItems = hit.items.slice();
            nextItems[hit.index] = {
                ...hit.item,
                text: String(nextText).trim()
            };
            extractFireRebuildTextResultPayload(nextItems);
            extractFireMergeResults = null;
            setDetectionExtractStatus('Da cap nhat noi dung text tren FE. Merge se dung text vua sua.', 'success');
        }

        updateDetectionExtractUI();
        if (typeof scheduleDraw === 'function') {
            scheduleDraw();
        }
        return true;
    }

    async function runExtractFireText() {
        if (extractFireIsStageRunning(EXTRACT_FIRE_STAGE_TEXT)) {
            extractFireCancelStageJob(EXTRACT_FIRE_STAGE_TEXT, 'user-cancelled');
            setDetectionExtractStatus('Da huy extract text.', 'info');
            return;
        }
        if (!hasRenderableDocument()) {
            setDetectionExtractStatus('Khong co du lieu de extract text.', 'error');
            return;
        }

        const stageRun = extractFireStartStageJob(EXTRACT_FIRE_STAGE_TEXT);
        setDetectionExtractStatus('Dang trich xuat text...');
        try {
            const textPayload = {
                filter_text: 'dn',
                use_ocr: true,
                use_words: true,
                use_annotations: true,
                scale: 3,
                max_workers: 16,
                max_avg_length: 8
            };
            const requestBundle = await buildExtractFirePageRequestPayload({ includePdf: false });
            extractFireAssertStageJobCurrent(EXTRACT_FIRE_STAGE_TEXT, stageRun.requestId, stageRun.pageKey);
            let result;
            try {
                result = await callExtractFireBackend('extract_fire_text', requestBundle, textPayload, { signal: stageRun.signal });
            } catch (error) {
                if (extractFireIsAbortError(error)) {
                    throw error;
                }
                if (!currentPdfFile || !extractFireShouldRetryTextWithPdfUpload(error)) {
                    throw error;
                }
                setDetectionExtractStatus('PDF chua co trong DB, dang upload mot lan roi retry extract text...');
                const retryBundle = await buildExtractFirePageRequestPayload({ includePdf: true });
                extractFireAssertStageJobCurrent(EXTRACT_FIRE_STAGE_TEXT, stageRun.requestId, stageRun.pageKey);
                result = await callExtractFireBackend('extract_fire_text', retryBundle, textPayload, { signal: stageRun.signal });
            }
            extractFireAssertStageJobCurrent(EXTRACT_FIRE_STAGE_TEXT, stageRun.requestId, stageRun.pageKey);
            extractFireTextResults = result;
            extractFireBindStageResultsToCurrentPage();
            extractFireMergeResults = null;
            setDetectionExtractStatus(`Text ${extractFireGetTextCount()} item(s) ready.`, 'success');
        } catch (error) {
            if (extractFireIsAbortError(error)) {
                setDetectionExtractStatus('Da huy extract text.', 'info');
                return;
            }
            console.error('Extract_FIRE text failed:', error);
            setDetectionExtractStatus(`Loi extract text: ${error.message}`, 'error');
        } finally {
            extractFireFinishStageJob(EXTRACT_FIRE_STAGE_TEXT, stageRun.requestId);
        }
    }

    async function runExtractFireSymbol() {
        if (extractFireIsStageRunning(EXTRACT_FIRE_STAGE_SYMBOL)) {
            extractFireCancelStageJob(EXTRACT_FIRE_STAGE_SYMBOL, 'user-cancelled');
            setDetectionExtractStatus('Da huy extract symbol.', 'info');
            return;
        }
        if (!hasRenderableDocument()) {
            setDetectionExtractStatus('Khong co du lieu de extract symbol.', 'error');
            return;
        }

        const stageRun = extractFireStartStageJob(EXTRACT_FIRE_STAGE_SYMBOL);
        const symbolSignatureBeforeRun = extractFireGetSymbolAnnotationSignature();
        setDetectionExtractStatus('Dang trich xuat symbol...');
        try {
            const requestBundle = await buildExtractFirePageRequestPayload({ includePdf: false });
            extractFireAssertStageJobCurrent(EXTRACT_FIRE_STAGE_SYMBOL, stageRun.requestId, stageRun.pageKey);
            const result = await callExtractFireBackend('extract_fire_symbol', requestBundle, {}, { signal: stageRun.signal });
            extractFireAssertStageJobCurrent(EXTRACT_FIRE_STAGE_SYMBOL, stageRun.requestId, stageRun.pageKey);
            extractFireSymbolResults = result;
            extractFireBindStageResultsToCurrentPage();
            const shouldApplyPersistedPayload = extractFireGetSymbolAnnotationSignature() === symbolSignatureBeforeRun;
            const importResult = extractFireImportApiSymbolsToPanel(result, {
                preferPersistedPayload: shouldApplyPersistedPayload
            });
            extractFireSyncEditableStateSignatures();
            if (importResult.label) {
                extractFireSymbolSource = EXTRACT_FIRE_SYMBOL_SOURCE_PANEL;
                if (typeof applySymbolAnnotationPanelState === 'function') {
                    applySymbolAnnotationPanelState(false);
                }
            }
            extractFireMergeResults = null;
            setDetectionExtractStatus(
                importResult.label
                    ? `Symbol API ${extractFireGetSymbolCount()} item(s) ready. Dong bo ${importResult.syncedCount ?? extractFireGetPanelSymbolCount()} bbox vao label ${EXTRACT_FIRE_IMPORTED_SYMBOL_LABEL_NAME}${importResult.persisted ? ' va da luu DB' : ''}.`
                    : `Symbol ${extractFireGetSymbolCount()} item(s) ready.`,
                'success'
            );
        } catch (error) {
            if (extractFireIsAbortError(error)) {
                setDetectionExtractStatus('Da huy extract symbol.', 'info');
                return;
            }
            console.error('Extract_FIRE symbol failed:', error);
            setDetectionExtractStatus(`Loi extract symbol: ${error.message}`, 'error');
        } finally {
            extractFireFinishStageJob(EXTRACT_FIRE_STAGE_SYMBOL, stageRun.requestId);
        }
    }

    async function runExtractFireMerge() {
        if (extractFireIsStageRunning(EXTRACT_FIRE_STAGE_MERGE)) {
            extractFireCancelStageJob(EXTRACT_FIRE_STAGE_MERGE, 'user-cancelled');
            setDetectionExtractStatus('Da huy merge Extract_FIRE.', 'info');
            return;
        }
        if (!extractFireHasSelectedLineData()) {
            setDetectionExtractStatus(extractFireLineSource === EXTRACT_FIRE_LINE_SOURCE_PANEL
                ? 'Chua co line trong panel Labels. Hay ve/sua Labels truoc khi merge.'
                : 'Chua co line final. Hay bam Extract Line truoc khi merge.', 'error');
            return;
        }

        const stageRun = extractFireStartStageJob(EXTRACT_FIRE_STAGE_MERGE);
        setDetectionExtractStatus('Dang merge line/text/symbol...');
        try {
            const response = await fetch(`${ENV.API_BASE_URL}/merge_extract_fire`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: stageRun.signal,
                body: JSON.stringify({
                    line_result: getExtractFireLineResultPayload(),
                    text_result: extractFireTextResults || {},
                    symbol_result: getExtractFireSymbolResultForMerge(),
                    input_data: getExtractFireTextSeqnoShapePayload(),
                    manual_annotations: getExtractFireManualAnnotationPayload(),
                    symbol_annotations: getExtractFireSymbolAnnotationsForMerge(),
                    sprinkler_bbox_padding: 10,
                    gen_uuid: true
                })
            });
            if (!response.ok) {
                throw new Error(await parseHttpErrorResponse(response));
            }
            const result = await response.json();
            extractFireAssertStageJobCurrent(EXTRACT_FIRE_STAGE_MERGE, stageRun.requestId, stageRun.pageKey);
            extractFireMergeResults = result;
            extractFireBindStageResultsToCurrentPage();
            pipelineRawResults = Array.isArray(result?.json_objects) ? result.json_objects : [];
            setDetectionExtractStatus(`Merge ${extractFireGetMergedCount()} object(s) ready. Line=${extractFireLineSource}, Symbol=${extractFireSymbolSource}.`, 'success');
        } catch (error) {
            if (extractFireIsAbortError(error)) {
                setDetectionExtractStatus('Da huy merge Extract_FIRE.', 'info');
                return;
            }
            console.error('Extract_FIRE merge failed:', error);
            setDetectionExtractStatus(`Loi merge: ${error.message}`, 'error');
        } finally {
            extractFireFinishStageJob(EXTRACT_FIRE_STAGE_MERGE, stageRun.requestId);
        }
    }

    function exportExtractFireMergedJson() {
        const objects = Array.isArray(extractFireMergeResults?.json_objects) ? extractFireMergeResults.json_objects : [];
        if (!objects.length) {
            setDetectionExtractStatus('Chua co merged Extract_FIRE JSON de export. Hay bam Merge truoc.', 'error');
            return;
        }
        const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(objects, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute('href', dataStr);
        downloadAnchorNode.setAttribute('download', `extract_fire_merged_page_${currentPageNum || 1}.json`);
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
        window.open('visual_pipeline_fire.html', '_blank');
    }

    function detectionSummaryMessage(rawResult, adjustedResult, autoAcceptResult = null, summary = null) {
        const rawCount = Number(summary?.raw_detection_count ?? rawResult?.num_detections ?? rawResult?.detections?.length ?? 0);
        const processedCount = Number(summary?.processed_detection_count ?? adjustedResult?.num_detections ?? adjustedResult?.detections?.length ?? 0);
        const finalCount = Number(summary?.auto_accept_annotation_count ?? autoAcceptResult?.manual_annotations?.length ?? 0);
        const postprocess = adjustedResult?.postprocess || {};
        const totalConnect = Number(postprocess.total_connect_detections || 0);
        const validConnect = Number(postprocess.validated_connect_detections || 0);
        const rejectedConnect = Number(postprocess.rejected_connect_detections || 0);
        return `raw ${rawCount} | process ${processedCount} | final ${finalCount} | connect ${validConnect}/${totalConnect} valid, ${rejectedConnect} rejected`;
    }

    function detectionFormatTimingMessage(bundleTiming = null, roundTripSeconds = 0) {
        const timing = bundleTiming && typeof bundleTiming === 'object' ? bundleTiming : {};
        const backendTotalSeconds = Number(timing.total_ms) / 1000;
        const rawSeconds = Number(timing.raw_ms) / 1000;
        const processedSeconds = Number(timing.processed_ms) / 1000;
        const autoAcceptSeconds = Number(timing.auto_accept_ms) / 1000;
        const segments = [];

        if (Number.isFinite(backendTotalSeconds) && backendTotalSeconds > 0) {
            segments.push(`BE ${backendTotalSeconds.toFixed(2)}s`);
        }

        const stageParts = [];
        if (Number.isFinite(rawSeconds) && rawSeconds > 0) stageParts.push(`raw ${rawSeconds.toFixed(2)}s`);
        if (Number.isFinite(processedSeconds) && processedSeconds > 0) stageParts.push(`proc ${processedSeconds.toFixed(2)}s`);
        if (Number.isFinite(autoAcceptSeconds) && autoAcceptSeconds > 0) stageParts.push(`final ${autoAcceptSeconds.toFixed(2)}s`);
        if (stageParts.length) {
            segments.push(stageParts.join(', '));
        }

        if (Number.isFinite(roundTripSeconds) && roundTripSeconds > 0) {
            segments.push(`RT ${roundTripSeconds.toFixed(2)}s`);
        }

        return segments.join(' | ');
    }

    async function runDetectionExtract() {
        if (extractFireIsStageRunning(EXTRACT_FIRE_STAGE_LINE)) {
            extractFireCancelStageJob(EXTRACT_FIRE_STAGE_LINE, 'user-cancelled');
            setDetectionExtractStatus('Da huy extract line.', 'info');
            return;
        }
        if (!hasRenderableDocument()) {
            setDetectionExtractStatus('Khong co du lieu de detect.', 'error');
            return;
        }

        const stageRun = extractFireStartStageJob(EXTRACT_FIRE_STAGE_LINE);
        const manualSignatureBeforeRun = extractFireGetManualAnnotationSignature();
        setDetectionExtractStatus('Dang chuan bi page JSON de backend tao anh layer x3...');

        try {
            clearDetectionVisualization({ refresh: true, preserveResults: true, clearStageResults: false });
            extractFireMergeResults = null;
            const requestBundle = await buildDetectionRequestPayload();
            const requestPayload = requestBundle.payload;
            extractFireAssertStageJobCurrent(EXTRACT_FIRE_STAGE_LINE, stageRun.requestId, stageRun.pageKey);

            setDetectionExtractStatus('Dang goi bundle detect...');

            const startTime = performance.now();
            const callDetectExtractBackend = async payload => {
                const response = await fetch(`${ENV.API_BASE_URL}/detect_extract_line_fire`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal: stageRun.signal
                });
                if (!response.ok) {
                    throw new Error(await parseHttpErrorResponse(response));
                }
                return response.json();
            };

            let bundleResult;
            try {
                bundleResult = await callDetectExtractBackend(requestPayload);
            } catch (error) {
                if (!requestBundle.preferServerPageCache || !requestBundle.fallbackGzipData || requestPayload.gzip_data) {
                    throw error;
                }
                setDetectionExtractStatus('Cache page JSON o backend bi miss, dang gui gzip_data fallback...');
                bundleResult = await callDetectExtractBackend({
                    ...requestPayload,
                    gzip_data: requestBundle.fallbackGzipData,
                    prefer_server_page_cache: false
                });
            }
            extractFireAssertStageJobCurrent(EXTRACT_FIRE_STAGE_LINE, stageRun.requestId, stageRun.pageKey);
            const roundTripSeconds = (performance.now() - startTime) / 1000;
            const isCompactLineResult = detectionIsCompactLineResult(bundleResult);
            const compactLineResult = isCompactLineResult ? bundleResult : null;
            const rawResult = isCompactLineResult ? null : (bundleResult?.raw || null);
            const adjustedResult = isCompactLineResult
                ? {
                    status: compactLineResult.status || 'ok',
                    detections: detectionClone(compactLineResult.detections || []),
                    num_detections: Number(compactLineResult.num_detections ?? compactLineResult.detections?.length ?? 0),
                    summary: detectionClone(compactLineResult.summary || {})
                }
                : (bundleResult?.processed || null);
            const autoAcceptResult = isCompactLineResult
                ? {
                    manual_annotations: detectionBuildManualAnnotationsFromLineResult(compactLineResult),
                    source: 'compact_line_result'
                }
                : (bundleResult?.auto_accept || null);

            extractFireLineResults = compactLineResult;
            detectionRawResults = rawResult;
            detectionAdjustedResults = adjustedResult;
            detectionAutoAcceptResults = autoAcceptResult;
            detectionOverlayContext = extractFireBuildBackendOverlayContext(bundleResult);
            const shouldHydrateManualAnnotations = extractFireGetManualAnnotationSignature() === manualSignatureBeforeRun
                || getExtractFireManualAnnotationPayload().length === 0;
            if (shouldHydrateManualAnnotations && typeof hydrateManualAnnotationsFromBackend === 'function' && autoAcceptResult) {
                hydrateManualAnnotationsFromBackend(autoAcceptResult, {
                    openPanel: false,
                    redraw: false
                });
                detectionAutoAcceptResults = {
                    ...(autoAcceptResult || {}),
                    manual_annotations: getExtractFireManualAnnotationPayload()
                };
            } else if (autoAcceptResult) {
                detectionAutoAcceptResults = {
                    ...(autoAcceptResult || {}),
                    manual_annotations: extractFireGetSharedFinalAnnotations()
                };
            }
            extractFireBindStageResultsToCurrentPage();
            extractFireSyncEditableStateSignatures();
            detectionEnsureAvailableViewMode();
            refreshDetectionVisualizationForCurrentView();

            setDetectionExtractStatus('Dang dong bo ket qua raw / process / final cho extract panel...');

            const summary = detectionSummaryMessage(rawResult, adjustedResult, autoAcceptResult, bundleResult?.summary);
            const backendCounts = autoAcceptResult?.counts || {};
            const addedConnectCount = Number(backendCounts.added_connect_count ?? backendCounts.addedConnectCount ?? 0);
            const acceptedConnectCount = Number(backendCounts.suggestion_accepted_connect_count ?? backendCounts.suggestionAcceptedConnectCount ?? 0);
            const manualSummary = addedConnectCount || acceptedConnectCount
                ? ` | BE manual +${addedConnectCount}C, accepted +${acceptedConnectCount}C`
                : '';
            const timingSummary = detectionFormatTimingMessage(bundleResult?.timing, roundTripSeconds);
            setDetectionExtractStatus(
                timingSummary ? `${summary}${manualSummary} | ${timingSummary}` : `${summary}${manualSummary}`,
                'success'
            );
        } catch (error) {
            if (extractFireIsAbortError(error)) {
                setDetectionExtractStatus('Da huy extract line.', 'info');
                return;
            }
            console.error('Line-fire detection failed:', error);
            setDetectionExtractStatus(`Loi detect: ${error.message}`, 'error');
        } finally {
            extractFireFinishStageJob(EXTRACT_FIRE_STAGE_LINE, stageRun.requestId);
        }
    }

    try {
        const storedCollapsed = localStorage.getItem(DETECTION_PANEL_STORAGE_KEY);
        applyDetectionExtractPanelState(storedCollapsed !== '0');
    } catch (error) {
        applyDetectionExtractPanelState(true);
    }

    if (typeof isSymbolAnnotationPanelCollapsed !== 'undefined') {
        handleExtractSymbolPanelStateChange(isSymbolAnnotationPanelCollapsed);
    }
    if (typeof isManualLabelPanelCollapsed !== 'undefined') {
        handleExtractLinePanelStateChange(isManualLabelPanelCollapsed);
    }

    if (btnToggleDetectExtractPanel) {
        btnToggleDetectExtractPanel.addEventListener('click', () => {
            applyDetectionExtractPanelState(!isDetectionExtractPanelCollapsed);
        });
    }

    if (btnRunDetectExtract) {
        btnRunDetectExtract.addEventListener('click', () => {
            void runDetectionExtract();
        });
    }

    if (btnPromoteExtractLineToLabels) {
        btnPromoteExtractLineToLabels.addEventListener('click', promoteExtractFinalLinesToManualPanel);
    }

    if (btnRunExtractFireText) {
        btnRunExtractFireText.addEventListener('click', () => {
            void runExtractFireText();
        });
    }

    if (btnRunExtractFireSymbol) {
        btnRunExtractFireSymbol.addEventListener('click', () => {
            void runExtractFireSymbol();
        });
    }

    if (btnRunExtractFireMerge) {
        btnRunExtractFireMerge.addEventListener('click', () => {
            void runExtractFireMerge();
        });
    }

    if (btnExportExtractFireJson) {
        btnExportExtractFireJson.addEventListener('click', exportExtractFireMergedJson);
    }

    [
        [btnExtractOverlayLine, 'line'],
        [btnExtractOverlayText, 'text'],
        [btnExtractOverlaySymbol, 'symbol'],
        [btnExtractOverlayMerge, 'merge']
    ].forEach(([button, key]) => {
        if (!button) return;
        button.addEventListener('click', () => {
            setExtractFireOverlayVisibility(key, !extractFireOverlayVisibility[key]);
        });
    });

    if (btnExtractLineSourceFinal) {
        btnExtractLineSourceFinal.addEventListener('click', () => setExtractFireLineSource(EXTRACT_FIRE_LINE_SOURCE_FINAL));
    }

    if (btnExtractLineSourcePanel) {
        btnExtractLineSourcePanel.addEventListener('click', () => setExtractFireLineSource(EXTRACT_FIRE_LINE_SOURCE_PANEL));
    }

    if (btnExtractSymbolSourcePanel) {
        btnExtractSymbolSourcePanel.addEventListener('click', () => setExtractFireSymbolSource(EXTRACT_FIRE_SYMBOL_SOURCE_PANEL));
    }

    if (btnExtractSymbolSourceApi) {
        btnExtractSymbolSourceApi.addEventListener('click', () => setExtractFireSymbolSource(EXTRACT_FIRE_SYMBOL_SOURCE_API));
    }

    if (btnExtractSymbolSourceBoth) {
        btnExtractSymbolSourceBoth.addEventListener('click', () => setExtractFireSymbolSource(EXTRACT_FIRE_SYMBOL_SOURCE_BOTH));
    }

    if (btnDetectViewProcessed) {
        btnDetectViewProcessed.addEventListener('click', () => {
            setDetectionResultViewMode(DETECTION_VIEW_MODE_PROCESSED);
        });
    }

    if (btnDetectViewRaw) {
        btnDetectViewRaw.addEventListener('click', () => {
            setDetectionResultViewMode(DETECTION_VIEW_MODE_RAW);
        });
    }

    if (btnDetectViewFinal) {
        btnDetectViewFinal.addEventListener('click', () => {
            setDetectionResultViewMode(DETECTION_VIEW_MODE_FINAL);
        });
    }

    if (btnClearDetectExtract) {
        btnClearDetectExtract.addEventListener('click', () => {
            cancelDetectionExtractJobs({ reason: 'clear-panel', keepStatus: true });
            clearDetectionVisualization();
            setDetectionExtractStatus('Da xoa ket qua detect.');
            updateDetectionExtractUI();
        });
    }

    if (detectExtractPanel) {
        ['mousedown', 'mouseup', 'mousemove', 'wheel', 'contextmenu'].forEach(eventName => {
            detectExtractPanel.addEventListener(eventName, event => {
                event.stopPropagation();
                if (eventName === 'contextmenu') {
                    event.preventDefault();
                }
            });
        });
    }

    updateDetectionExtractUI();
    window.applyDetectionExtractPanelState = applyDetectionExtractPanelState;
    window.updateDetectionExtractUI = updateDetectionExtractUI;
    window.refreshDetectionExtractUI = refreshDetectionExtractFromEditableState;
    window.clearDetectionVisualization = clearDetectionVisualization;
    window.drawDetectionExtractOverlays = drawDetectionExtractOverlays;
    window.invalidateDetectionExtractImageCache = detectionInvalidateExtractImageCache;
    window.handleDetectionExtractCanvasClick = handleDetectionExtractCanvasClick;
    window.handleDetectionExtractDocumentLoaded = handleDetectionExtractDocumentLoaded;
    window.cancelDetectionExtractJobs = cancelDetectionExtractJobs;
    window.isDetectionExtractManualEditingAllowed = isDetectionExtractManualEditingAllowed;
    window.handleExtractLinePanelStateChange = handleExtractLinePanelStateChange;
    window.handleExtractSymbolPanelStateChange = handleExtractSymbolPanelStateChange;
    window.shouldHideManualAnnotationOverlay = function () {
        const isAnnotationEditingActive = typeof annotationMode !== 'undefined' && Boolean(annotationMode);
        const hasPendingManualPoint = typeof pendingConnectPoint !== 'undefined' && Boolean(pendingConnectPoint);
        const hasHoveredManualSnap = typeof hoveredSnapPoint !== 'undefined' && Boolean(hoveredSnapPoint);
        const hasSuggestions = typeof hasSuggestedConnectAnnotations === 'function' && hasSuggestedConnectAnnotations();
        return !extractFireOverlayVisibility.line
            && !isAnnotationEditingActive
            && !hasPendingManualPoint
            && !hasHoveredManualSnap
            && !hasSuggestions;
    };
    window.shouldSuppressManualAnnotationOverlay = function () {
        if (detectionResultViewMode !== DETECTION_VIEW_MODE_FINAL) {
            return detectionGetResultCountForViewMode() > 0;
        }
        const isAnnotationEditingActive = typeof annotationMode !== 'undefined' && Boolean(annotationMode);
        const hasPendingManualPoint = typeof pendingConnectPoint !== 'undefined' && Boolean(pendingConnectPoint);
        const hasHoveredManualSnap = typeof hoveredSnapPoint !== 'undefined' && Boolean(hoveredSnapPoint);
        return extractFireOverlayVisibility.line
            && detectionGetFinalResultCount() > 0
            && !isAnnotationEditingActive
            && !hasPendingManualPoint
            && !hasHoveredManualSnap
            && !(typeof hasSuggestedConnectAnnotations === 'function' && hasSuggestedConnectAnnotations());
    };
    window.shouldSuppressSymbolAnnotationOverlay = function () {
        return extractFireOverlayVisibility.symbol
            && extractFireSymbolSource !== EXTRACT_FIRE_SYMBOL_SOURCE_API
            && extractFireGetSelectedSymbolItems().length > 0;
    };
    window.shouldHideSymbolAnnotationOverlay = function () {
        const isSymbolFindActive = typeof isSymbolFindArmed !== 'undefined' && Boolean(isSymbolFindArmed);
        const isSymbolDeleteActive = typeof isSymbolDeleteArmed !== 'undefined' && Boolean(isSymbolDeleteArmed);
        return !extractFireOverlayVisibility.symbol && !isSymbolFindActive && !isSymbolDeleteActive;
    };
    window.runDetectionExtract = runDetectionExtract;
    window.runExtractFireText = runExtractFireText;
    window.runExtractFireSymbol = runExtractFireSymbol;
    window.runExtractFireMerge = runExtractFireMerge;
})();
