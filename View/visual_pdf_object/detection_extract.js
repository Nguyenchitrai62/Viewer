(function () {
    const detectExtractPanel = document.getElementById('detect-extract-panel');
    const btnToggleDetectExtractPanel = document.getElementById('btn-toggle-detect-extract-panel');
    const detectExtractCountBadge = document.getElementById('detect-extract-count-badge');
    const detectExtractStatus = document.getElementById('detect-extract-status');
    const detectExtractSummary = document.getElementById('detect-extract-summary');
    const btnDetectViewProcessed = document.getElementById('btn-detect-view-processed');
    const btnDetectViewRaw = document.getElementById('btn-detect-view-raw');
    const btnRunDetectExtract = document.getElementById('btn-run-detect-extract');
    const btnClearDetectExtract = document.getElementById('btn-clear-detect-extract');

    const DETECTION_PANEL_STORAGE_KEY = 'visual_pdf_object.detect_extract_collapsed';
    const DETECTION_VIEW_MODE_RAW = 'raw';
    const DETECTION_VIEW_MODE_PROCESSED = 'processed';
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
    const DETECTION_CACHE_BOUNDS_EPSILON = 1e-4;
    const DETECTION_CACHE_SCALE_EPSILON = 1e-3;

    let isDetectionExtractPanelCollapsed = true;
    let isDetectionExtractRunning = false;
    let detectionExtractImageCache = null;
    let detectionOverlayContext = null;
    let detectionResultViewMode = DETECTION_VIEW_MODE_PROCESSED;

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

    function detectionGetResultForViewMode(viewMode = detectionResultViewMode) {
        if (viewMode === DETECTION_VIEW_MODE_RAW) {
            return detectionRawResults;
        }
        return detectionAdjustedResults;
    }

    function detectionEnsureAvailableViewMode() {
        const rawCount = detectionGetRawResultCount();
        const processedCount = detectionGetProcessedResultCount();
        if (detectionResultViewMode === DETECTION_VIEW_MODE_RAW && !rawCount && processedCount) {
            detectionResultViewMode = DETECTION_VIEW_MODE_PROCESSED;
        } else if (detectionResultViewMode === DETECTION_VIEW_MODE_PROCESSED && !processedCount && rawCount) {
            detectionResultViewMode = DETECTION_VIEW_MODE_RAW;
        }
    }

    function detectionFormatCoverageThreshold() {
        return `${Math.round(DETECTION_CONNECT_VERIFY_MIN_COVERAGE_RATIO * 100)}%`;
    }

    function updateDetectionExtractSummary() {
        if (!detectExtractSummary) return;
        detectExtractSummary.textContent = `Raw ${detectionGetRawResultCount()} | Processed ${detectionGetProcessedResultCount()} | Verify >= ${detectionFormatCoverageThreshold()}`;
    }

    function refreshDetectionVisualizationForCurrentView() {
        const activeResult = detectionGetResultForViewMode();
        if (!activeResult || !detectionOverlayContext) return false;
        applyDetectionResultsToLayers(activeResult, detectionOverlayContext);
        return true;
    }

    function setDetectionResultViewMode(nextMode, options = {}) {
        if (nextMode !== DETECTION_VIEW_MODE_RAW && nextMode !== DETECTION_VIEW_MODE_PROCESSED) {
            return;
        }
        detectionResultViewMode = nextMode;
        detectionEnsureAvailableViewMode();
        if (options.refreshVisualization !== false && !isDetectionExtractRunning) {
            refreshDetectionVisualizationForCurrentView();
        }
        updateDetectionExtractUI();
    }

    function updateDetectionExtractUI() {
        detectionEnsureAvailableViewMode();
        const activeResult = detectionGetResultForViewMode();
        const detectionCount = Array.isArray(activeResult?.detections) ? activeResult.detections.length : 0;
        const rawCount = detectionGetRawResultCount();
        const processedCount = detectionGetProcessedResultCount();
        if (detectExtractCountBadge) {
            detectExtractCountBadge.textContent = String(detectionCount);
        }
        updateDetectionExtractSummary();
        if (btnDetectViewProcessed) {
            const isActive = detectionResultViewMode === DETECTION_VIEW_MODE_PROCESSED;
            btnDetectViewProcessed.classList.toggle('is-active', isActive);
            btnDetectViewProcessed.setAttribute('aria-pressed', String(isActive));
            btnDetectViewProcessed.disabled = isDetectionExtractRunning || processedCount === 0;
        }
        if (btnDetectViewRaw) {
            const isActive = detectionResultViewMode === DETECTION_VIEW_MODE_RAW;
            btnDetectViewRaw.classList.toggle('is-active', isActive);
            btnDetectViewRaw.setAttribute('aria-pressed', String(isActive));
            btnDetectViewRaw.disabled = isDetectionExtractRunning || rawCount === 0;
        }
        if (btnRunDetectExtract) {
            btnRunDetectExtract.disabled = isDetectionExtractRunning || !hasRenderableDocument();
            btnRunDetectExtract.textContent = isDetectionExtractRunning ? 'Running...' : 'Detect';
        }
        if (btnClearDetectExtract) {
            btnClearDetectExtract.disabled = isDetectionExtractRunning || (!rawCount && !processedCount);
        }
        if (!rawCount && !processedCount && detectExtractStatus && !isDetectionExtractRunning) {
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
        } catch (error) {
            console.warn('Failed to persist detection panel state:', error);
        }
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
            detectionOverlayContext = null;
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
            maxSuggestionRounds: 2,
            fullRecheckExistingConnects: true,
            requestNextSuggestions: false,
            openPanel: true
        });
    }

    function buildDetectionRequestPayload(imagePayload) {
        return {
            image_b64: imagePayload.imageB64,
            image_name: imagePayload.imageName,
            use_sahi: true
        };
    }

    function detectionSummaryMessage(rawResult, adjustedResult) {
        const rawCount = Number(rawResult?.num_detections ?? rawResult?.detections?.length ?? 0);
        const finalCount = Number(adjustedResult?.num_detections ?? adjustedResult?.detections?.length ?? 0);
        const postprocess = adjustedResult?.postprocess || {};
        const totalConnect = Number(postprocess.total_connect_detections || 0);
        const validConnect = Number(postprocess.validated_connect_detections || 0);
        const rejectedConnect = Number(postprocess.rejected_connect_detections || 0);
        return `raw ${rawCount} | final ${finalCount} | connect ${validConnect}/${totalConnect} valid, ${rejectedConnect} rejected`;
    }

    function detectionFormatTimingMessage(apiTimeSeconds, logicTimeSeconds) {
        return `BE API ${apiTimeSeconds.toFixed(2)}s | Logic+Auto ${logicTimeSeconds.toFixed(2)}s`;
    }

    async function runDetectionExtract() {
        if (isDetectionExtractRunning) return;
        if (!hasRenderableDocument()) {
            alert('Khong co du lieu de detect.');
            return;
        }

        isDetectionExtractRunning = true;
        updateDetectionExtractUI();
        setDetectionExtractStatus('Dang tao anh layer x3...');
        showLoadingPopup('Detecting line-fire objects...', 'Rendering visible layers at x3.');

        try {
            clearDetectionVisualization({ refresh: true });
            const imagePayload = await createDetectionExtractImagePayload();
            const snapPointWarmupPromise = typeof ensureSnapPointIndexAsync === 'function' && typeof hasManualLineCandidateSource === 'function' && hasManualLineCandidateSource()
                ? ensureSnapPointIndexAsync().catch(error => {
                    console.warn('Detection manual snap index warmup failed:', error);
                    return false;
                })
                : Promise.resolve(false);
            updateLoadingPopup('Detecting line-fire objects...', 'Calling batch worker API...');
            setDetectionExtractStatus(imagePayload.fromCache || imagePayload.fromRasterCache
                ? 'Dang goi worker detect hang loat tu anh cache...'
                : 'Dang goi worker detect hang loat...');

            const startTime = performance.now();
            const response = await fetch(`${ENV.API_BASE_URL}/detect_line_fire_sahi`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildDetectionRequestPayload(imagePayload))
            });
            if (!response.ok) {
                throw new Error(await parseHttpErrorResponse(response));
            }
            const rawResult = await response.json();
            const apiTimeSeconds = (performance.now() - startTime) / 1000;
            detectionRawResults = rawResult;
            detectionOverlayContext = imagePayload;

            updateLoadingPopup('Detecting line-fire objects...', 'Dang xu ly logic va goi y auto accept...');
            setDetectionExtractStatus('Dang xu ly logic detect va goi y auto accept...');
            const logicStartTime = performance.now();
            await snapPointWarmupPromise;
            const adjustedResult = adjustDetectionConnectsForVisibleLines(rawResult, imagePayload);
            detectionAdjustedResults = adjustedResult;
            refreshDetectionVisualizationForCurrentView();

            const manualPromotionResult = await detectionPromoteConnectsToManualPanel(adjustedResult);
            adjustedResult.manual_promotion = manualPromotionResult;
            const logicTimeSeconds = (performance.now() - logicStartTime) / 1000;

            const summary = detectionSummaryMessage(rawResult, adjustedResult);
            console.log('Line-fire detection result:', rawResult);
            console.log('Line-fire adjusted result:', adjustedResult);
            console.log('Line-fire timing:', {
                backend_api_seconds: apiTimeSeconds,
                logic_and_auto_accept_seconds: logicTimeSeconds
            });
            const manualSummary = manualPromotionResult.addedConnectCount || manualPromotionResult.suggestionAcceptedConnectCount
                ? ` | manual +${manualPromotionResult.addedConnectCount}C, auto +${manualPromotionResult.suggestionAcceptedConnectCount}C`
                : '';
            const timingSummary = detectionFormatTimingMessage(apiTimeSeconds, logicTimeSeconds);
            setDetectionExtractStatus(`${summary}${manualSummary} | ${timingSummary}`, 'success');
        } catch (error) {
            console.error('Line-fire detection failed:', error);
            setDetectionExtractStatus(`Loi detect: ${error.message}`, 'error');
            alert(`Line-fire detect failed: ${error.message}`);
        } finally {
            isDetectionExtractRunning = false;
            hideLoadingPopup();
            updateDetectionExtractUI();
        }
    }

    try {
        const storedCollapsed = localStorage.getItem(DETECTION_PANEL_STORAGE_KEY);
        applyDetectionExtractPanelState(storedCollapsed !== '0');
    } catch (error) {
        applyDetectionExtractPanelState(true);
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

    if (btnClearDetectExtract) {
        btnClearDetectExtract.addEventListener('click', () => {
            clearDetectionVisualization();
            setDetectionExtractStatus('Da xoa ket qua detect.');
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
    window.clearDetectionVisualization = clearDetectionVisualization;
    window.invalidateDetectionExtractImageCache = detectionInvalidateExtractImageCache;
    window.runDetectionExtract = runDetectionExtract;
})();