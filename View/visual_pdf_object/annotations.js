const MANUAL_LABEL_COLORS = Object.freeze({
    junction: '#ef4444',
    connect: '#0ea5e9',
    delete: '#f59e0b',
    pending: '#f59e0b',
    snap: '#10b981',
    idle: '#111827'
});

function isExportableAnnotationLayer(layerName) {
    return Boolean(layerName) && !layerName.startsWith('svg_') && !pipelineLayerNames.includes(layerName);
}

function getShapeLayerNameForField(shape, field = currentLayerField) {
    if (!shape) return null;
    if (field === 'layer_1') {
        const layerName = typeof shape.source_layer_1 === 'string' ? shape.source_layer_1 : shape.layer_1;
        return layerName && layerName.startsWith('shape_color_') ? layerName : null;
    }
    const layerName = typeof shape.source_layer === 'string' ? shape.source_layer : shape.layer;
    if (!layerName || !layerName.trim()) return '__default_shape_layer__';
    return layerName;
}

function cloneAnnotationPoint(point) {
    return {
        x: Number(point.x),
        y: Number(point.y),
        layerName: point.layerName
    };
}

function cloneAnnotation(annotation) {
    return {
        id: annotation.id,
        type: annotation.type,
        layerName: annotation.layerName,
        source: annotation.source || 'manual',
        autoManaged: Boolean(annotation.autoManaged),
        points: (annotation.points || []).map(cloneAnnotationPoint)
    };
}

function createAnnotation(type, layerName, points, options = {}) {
    manualAnnotationId += 1;
    return {
        id: manualAnnotationId,
        type,
        layerName,
        source: options.source || 'manual',
        autoManaged: Boolean(options.autoManaged),
        points: points.map(point => ({
            x: Number(point.x),
            y: Number(point.y),
            layerName
        }))
    };
}

function getManualLabelHalfSizeWorld() {
    return CONFIG.MANUAL_LABEL_BBOX_PTS / 2;
}

function getPolygonBounds(points) {
    if (!Array.isArray(points) || !points.length) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    points.forEach(point => {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
    });
    return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY
    };
}

function getManualAnnotationWorldPolygon(annotation) {
    if (!annotation || !Array.isArray(annotation.points) || annotation.points.length === 0) return null;
    const halfSize = getManualLabelHalfSizeWorld();
    if (annotation.type === 'junction') {
        const center = annotation.points[0];
        return [
            { x: center.x - halfSize, y: center.y - halfSize },
            { x: center.x + halfSize, y: center.y - halfSize },
            { x: center.x + halfSize, y: center.y + halfSize },
            { x: center.x - halfSize, y: center.y + halfSize }
        ];
    }

    const [pointA, pointB] = annotation.points;
    const dx = pointB.x - pointA.x;
    const dy = pointB.y - pointA.y;
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

function getManualAnnotationWorldRect(annotation) {
    const polygon = getManualAnnotationWorldPolygon(annotation);
    return getPolygonBounds(polygon);
}

function isPointInsidePolygon(px, py, polygon) {
    if (!Array.isArray(polygon) || polygon.length < 3) return false;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x;
        const yi = polygon[i].y;
        const xj = polygon[j].x;
        const yj = polygon[j].y;
        const intersect = ((yi > py) !== (yj > py))
            && (px < (((xj - xi) * (py - yi)) / ((yj - yi) || 1e-12)) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function distancePointToPolygon(px, py, polygon) {
    if (!Array.isArray(polygon) || !polygon.length) return Infinity;
    if (isPointInsidePolygon(px, py, polygon)) return 0;
    let bestDistance = Infinity;
    for (let index = 0; index < polygon.length; index += 1) {
        const pointA = polygon[index];
        const pointB = polygon[(index + 1) % polygon.length];
        bestDistance = Math.min(bestDistance, distancePointToSegment(px, py, pointA.x, pointA.y, pointB.x, pointB.y));
    }
    return bestDistance;
}

function getManualLabelCounts() {
    const counts = { junction: 0, connect: 0, total: manualAnnotations.length };
    manualAnnotations.forEach(annotation => {
        if (annotation.type === 'junction') counts.junction += 1;
        if (annotation.type === 'connect') counts.connect += 1;
    });
    return counts;
}

function setAnnotationFeedback(message = '', tone = 'info') {
    annotationFeedbackMessage = message;
    annotationFeedbackTone = tone;
    updateManualLabelUI();
}

function getActionHistoryDepth() {
    return manualAnnotationHistory.length + (pendingConnectPoint ? 1 : 0);
}

function updateManualLabelUI() {
    if (btnLabelJunction) btnLabelJunction.classList.toggle('active', annotationMode === 'junction');
    if (btnLabelConnect) btnLabelConnect.classList.toggle('active', annotationMode === 'connect');
    if (btnClearLabels) {
        btnClearLabels.classList.toggle('active', annotationMode === 'delete');
        btnClearLabels.disabled = manualAnnotations.length === 0;
    }
    if (btnUndoLabel) btnUndoLabel.disabled = getActionHistoryDepth() === 0;
    if (btnExportLabelPackage) btnExportLabelPackage.disabled = manualAnnotations.length === 0;
    if (manualLabelCountBadge) {
        manualLabelCountBadge.textContent = String(manualAnnotations.length);
    }

    if (!manualLabelStatus) return;

    if (!jsonShapes || !jsonShapes.length) {
        manualLabelStatus.innerHTML = '<div>mode: off</div><div>0 labels</div>';
        return;
    }

    const counts = getManualLabelCounts();
    const autoJunctionCount = manualAnnotations.filter(annotation => annotation.type === 'junction' && annotation.autoManaged).length;
    if (manualLabelCountBadge) {
        manualLabelCountBadge.textContent = String(counts.total);
    }
    const statusLines = [
        `<div><strong>${counts.total}</strong> total • J ${counts.junction} • C ${counts.connect} • auto ${autoJunctionCount}</div>`
    ];

    if (annotationMode === 'junction') {
        statusLines.push('<div>mode: junction</div>');
    } else if (annotationMode === 'connect') {
        if (pendingConnectPoint) {
            statusLines.push(`<div>mode: connect • point 1 locked • ${escapeHtml(pendingConnectPoint.layerName)}</div>`);
        } else {
            statusLines.push('<div>mode: connect</div>');
        }
    } else if (annotationMode === 'delete') {
        statusLines.push('<div>mode: delete</div>');
    } else {
        statusLines.push('<div>mode: off</div>');
    }

    statusLines.push('<div>export: 1 image + 1 txt label</div>');

    if (annotationFeedbackMessage) {
        const feedbackClass = annotationFeedbackTone === 'error' ? 'manual-label-feedback is-error' : 'manual-label-feedback';
        statusLines.push(`<div class="${feedbackClass}">${escapeHtml(annotationFeedbackMessage)}</div>`);
    }

    manualLabelStatus.innerHTML = statusLines.join('');
}

function areSameSnapPoint(pointA, pointB) {
    if (!pointA || !pointB) return false;
    return pointA.layerName === pointB.layerName
        && Math.abs(pointA.x - pointB.x) <= 1e-6
        && Math.abs(pointA.y - pointB.y) <= 1e-6;
}

function hasDuplicateAnnotation(candidate) {
    return manualAnnotations.some(annotation => {
        if (annotation.type !== candidate.type || annotation.layerName !== candidate.layerName) return false;
        if (annotation.type === 'junction') {
            return areSameSnapPoint(annotation.points[0], candidate.points[0]);
        }
        const [a1, a2] = annotation.points;
        const [b1, b2] = candidate.points;
        return (areSameSnapPoint(a1, b1) && areSameSnapPoint(a2, b2))
            || (areSameSnapPoint(a1, b2) && areSameSnapPoint(a2, b1));
    });
}

function findMatchingJunctionAtPoint(point, layerName) {
    return manualAnnotations.find(annotation =>
        annotation.type === 'junction'
        && annotation.layerName === layerName
        && areSameSnapPoint(annotation.points[0], point)
    ) || null;
}

function doesAnotherConnectUsePoint(point, layerName, excludedIds = new Set()) {
    return manualAnnotations.some(annotation =>
        annotation.type === 'connect'
        && annotation.layerName === layerName
        && !excludedIds.has(annotation.id)
        && annotation.points.some(connectPoint => areSameSnapPoint(connectPoint, point))
    );
}

function addHistoryEntry(kind, annotations) {
    if (!annotations.length) return;
    manualAnnotationHistory.push({
        kind,
        annotations: annotations.map(cloneAnnotation)
    });
}

function addAnnotations(annotations, options = {}) {
    const added = [];
    annotations.forEach(annotation => {
        if (hasDuplicateAnnotation(annotation)) return;
        manualAnnotations.push(cloneAnnotation(annotation));
        added.push(annotation);
    });
    if (options.record !== false && added.length) {
        addHistoryEntry('add', added);
    }
    updateManualLabelUI();
    if (typeof scheduleDraw === 'function') scheduleDraw();
    return added;
}

function removeAnnotationsByIds(annotationIds, options = {}) {
    const idSet = new Set(annotationIds);
    const removed = manualAnnotations.filter(annotation => idSet.has(annotation.id));
    if (!removed.length) return [];
    manualAnnotations = manualAnnotations.filter(annotation => !idSet.has(annotation.id));
    if (options.record !== false) {
        addHistoryEntry('delete', removed);
    }
    if (hoveredAnnotationId !== null && idSet.has(hoveredAnnotationId)) {
        hoveredAnnotationId = null;
    }
    updateManualLabelUI();
    if (typeof scheduleDraw === 'function') scheduleDraw();
    return removed;
}

function rebuildSnapPointIndex() {
    snapPoints = [];
    snapPointQuadtree = null;
    hoveredSnapPoint = null;

    if (!allShapesSorted || !allShapesSorted.length) {
        updateManualLabelUI();
        return;
    }

    const uniquePoints = new Map();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    allShapesSorted.forEach(shape => {
        const layerName = getShapeLayerNameForField(shape, currentLayerField);
        if (!isExportableAnnotationLayer(layerName) || !Array.isArray(shape.items)) return;

        shape.items.forEach((item, itemIndex) => {
            if (item[0] !== 'l') return;
            [item[1], item[2]].forEach((point, endpointIndex) => {
                if (!Array.isArray(point) || point.length < 2) return;
                const x = Number(point[0]);
                const y = Number(point[1]);
                if (!Number.isFinite(x) || !Number.isFinite(y)) return;

                const key = `${layerName}|${x.toFixed(3)}|${y.toFixed(3)}`;
                if (!uniquePoints.has(key)) {
                    uniquePoints.set(key, {
                        id: key,
                        x,
                        y,
                        layerName,
                        bbox: { minX: x, minY: y, maxX: x, maxY: y },
                        refs: []
                    });
                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x);
                    maxY = Math.max(maxY, y);
                }

                uniquePoints.get(key).refs.push({ shapeId: shape.id, itemIndex, endpointIndex });
            });
        });
    });

    snapPoints = Array.from(uniquePoints.values());

    if (!snapPoints.length || minX === Infinity) {
        updateManualLabelUI();
        return;
    }

    const padding = 10;
    snapPointQuadtree = new Quadtree({
        x: minX - padding,
        y: minY - padding,
        width: Math.max((maxX - minX) + padding * 2, padding * 2),
        height: Math.max((maxY - minY) + padding * 2, padding * 2)
    }, 25, 8);

    snapPoints.forEach(point => snapPointQuadtree.insert(point));
    updateManualLabelUI();
}

function getAnnotationSnapToleranceWorld() {
    return CONFIG.MANUAL_LABEL_SNAP_SCREEN_PX / Math.max(zoom, 0.01);
}

function findNearestSnapPoint(worldX, worldY, options = {}) {
    if (!snapPointQuadtree) return null;
    const worldTolerance = options.worldTolerance || getAnnotationSnapToleranceWorld();
    const queryRange = {
        minX: worldX - worldTolerance,
        minY: worldY - worldTolerance,
        maxX: worldX + worldTolerance,
        maxY: worldY + worldTolerance
    };

    const requiredLayerName = options.layerName || null;
    const candidates = Array.from(new Set(snapPointQuadtree.query(queryRange)));
    let nearest = null;
    let bestDistance = Infinity;

    candidates.forEach(point => {
        if (!point || !layerVisibility[point.layerName]) return;
        if (requiredLayerName && point.layerName !== requiredLayerName) return;
        const distance = Math.hypot(point.x - worldX, point.y - worldY);
        if (distance <= worldTolerance && distance < bestDistance) {
            bestDistance = distance;
            nearest = point;
        }
    });

    return nearest;
}

function distancePointToRect(px, py, rect) {
    const dx = Math.max(rect.x - px, 0, px - (rect.x + rect.width));
    const dy = Math.max(rect.y - py, 0, py - (rect.y + rect.height));
    return Math.hypot(dx, dy);
}

function findNearestAnnotation(worldX, worldY) {
    const worldTolerance = getAnnotationSnapToleranceWorld();
    let nearest = null;
    let bestScore = Infinity;

    manualAnnotations.forEach(annotation => {
        if (!layerVisibility[annotation.layerName]) return;
        const polygon = getManualAnnotationWorldPolygon(annotation);
        if (!polygon) return;

        let score = distancePointToPolygon(worldX, worldY, polygon);
        if (annotation.type === 'junction') {
            score = Math.min(score, Math.hypot(worldX - annotation.points[0].x, worldY - annotation.points[0].y));
        }

        if (score <= worldTolerance && score < bestScore) {
            nearest = annotation;
            bestScore = score;
        }
    });

    return nearest;
}

function refreshAnnotationModeLabel() {
    if (typeof updateModeLabel === 'function') {
        updateModeLabel(annotationMode);
    }
}

function deactivateManualLabelMode(options = {}) {
    annotationMode = null;
    hoveredSnapPoint = null;
    hoveredAnnotationId = null;
    if (options.clearPending !== false) {
        pendingConnectPoint = null;
    }
    canvasContainer.classList.remove('annotation-junction-mode', 'annotation-connect-mode', 'annotation-delete-mode');
    refreshAnnotationModeLabel();
    updateManualLabelUI();
    if (typeof scheduleDraw === 'function') scheduleDraw();
}

function setAnnotationMode(mode) {
    if (!jsonShapes || !jsonShapes.length) {
        setAnnotationFeedback('Chưa có dữ liệu để gán nhãn.', 'error');
        return;
    }

    if ((mode === 'junction' || mode === 'connect') && !snapPoints.length) {
        setAnnotationFeedback('Không tìm thấy endpoint line để snap.', 'error');
        return;
    }

    if (mode === 'delete' && !manualAnnotations.length) {
        setAnnotationFeedback('Chưa có nhãn nào để xóa.', 'error');
        return;
    }

    if (annotationMode === mode) {
        deactivateManualLabelMode();
        return;
    }

    if (isDrawingBbox) {
        isDrawingBbox = false;
        bboxStart = null;
        currentBbox = null;
        btnDrawBbox.textContent = UI_TEXT.DRAW_FIND;
        btnDrawBbox.classList.remove('active');
        canvasContainer.classList.remove('drawing-bbox');
    }

    if (isVLMBboxMode) {
        isVLMBboxMode = false;
        vlmBboxStart = null;
        vlmBboxEnd = null;
        isVLMDrawing = false;
        btnVLMExtract.textContent = UI_TEXT.VLM_EXTRACT;
        btnVLMExtract.classList.remove('active');
        canvasContainer.classList.remove('vlm-bbox-mode');
    }

    annotationMode = mode;
    pendingConnectPoint = null;
    hoveredSnapPoint = mode === 'delete' ? null : findNearestSnapPoint(mouseX, mouseY);
    hoveredAnnotationId = mode === 'delete' ? (findNearestAnnotation(mouseX, mouseY)?.id || null) : null;
    canvasContainer.classList.toggle('annotation-junction-mode', mode === 'junction');
    canvasContainer.classList.toggle('annotation-connect-mode', mode === 'connect');
    canvasContainer.classList.toggle('annotation-delete-mode', mode === 'delete');

    if (mode === 'connect') {
        setAnnotationFeedback('Chọn điểm 1 cho connect. Hệ thống sẽ tự thêm junction ở hai đầu.', 'info');
    } else if (mode === 'junction') {
        setAnnotationFeedback('Click vào endpoint line để tạo junction.', 'info');
    } else {
        setAnnotationFeedback('Click vào label muốn xóa. Ctrl+Z để phục hồi.', 'info');
    }

    refreshAnnotationModeLabel();
    if (typeof scheduleDraw === 'function') scheduleDraw();
}

function resetManualLabelState(options = {}) {
    manualAnnotations = [];
    manualAnnotationId = 0;
    manualAnnotationHistory = [];
    pendingConnectPoint = null;
    hoveredSnapPoint = null;
    hoveredAnnotationId = null;
    annotationFeedbackMessage = options.message || '';
    annotationFeedbackTone = options.tone || 'info';

    if (options.clearMode !== false) {
        annotationMode = null;
        canvasContainer.classList.remove('annotation-junction-mode', 'annotation-connect-mode', 'annotation-delete-mode');
        refreshAnnotationModeLabel();
    }

    updateManualLabelUI();
    if (typeof scheduleDraw === 'function') scheduleDraw();
}

function undoManualAnnotation() {
    if (pendingConnectPoint) {
        pendingConnectPoint = null;
        hoveredSnapPoint = null;
        setAnnotationFeedback('Đã hủy điểm 1 của connect.', 'info');
        refreshAnnotationModeLabel();
        if (typeof scheduleDraw === 'function') scheduleDraw();
        return;
    }

    if (!manualAnnotationHistory.length) return;
    const action = manualAnnotationHistory.pop();
    const annotationIds = action.annotations.map(annotation => annotation.id);
    if (action.kind === 'add') {
        removeAnnotationsByIds(annotationIds, { record: false });
        setAnnotationFeedback('Đã undo thao tác thêm nhãn gần nhất.', 'info');
    } else if (action.kind === 'delete') {
        addAnnotations(action.annotations, { record: false });
        setAnnotationFeedback('Đã khôi phục nhãn vừa xóa.', 'info');
    }
    refreshAnnotationModeLabel();
}

function clearManualAnnotations() {
    if (!manualAnnotations.length && !pendingConnectPoint) return;
    resetManualLabelState({ clearMode: false, message: 'Đã xóa toàn bộ nhãn thủ công.', tone: 'info' });
}

function createAutoJunctionsForConnect(layerName, points) {
    return points
        .filter(point => !findMatchingJunctionAtPoint(point, layerName))
        .map(point => createAnnotation('junction', layerName, [point], { source: 'auto', autoManaged: true }));
}

function collectCascadeDeleteAnnotations(targetAnnotation) {
    if (!targetAnnotation) return [];

    if (targetAnnotation.type === 'junction') {
        if (targetAnnotation.autoManaged && doesAnotherConnectUsePoint(targetAnnotation.points[0], targetAnnotation.layerName)) {
            setAnnotationFeedback('Junction này đang được connect sử dụng. Hãy xóa connect trước.', 'error');
            return [];
        }
        return [targetAnnotation];
    }

    const cascade = [targetAnnotation];
    const excludedConnectIds = new Set([targetAnnotation.id]);
    targetAnnotation.points.forEach(point => {
        const junction = findMatchingJunctionAtPoint(point, targetAnnotation.layerName);
        if (!junction || !junction.autoManaged) return;
        if (!doesAnotherConnectUsePoint(point, targetAnnotation.layerName, excludedConnectIds)) {
            cascade.push(junction);
        }
    });
    return cascade;
}

function deleteAnnotationAtPoint(worldX, worldY) {
    const annotation = findNearestAnnotation(worldX, worldY);
    if (!annotation) {
        setAnnotationFeedback('Không có label nào ở vị trí click để xóa.', 'error');
        return true;
    }

    const cascade = collectCascadeDeleteAnnotations(annotation);
    if (!cascade.length) return true;
    removeAnnotationsByIds(cascade.map(item => item.id), { record: true });
    const removedConnects = cascade.filter(item => item.type === 'connect').length;
    const removedJunctions = cascade.filter(item => item.type === 'junction').length;
    setAnnotationFeedback(`Đã xóa ${removedConnects} connect và ${removedJunctions} junction.`, 'info');
    return true;
}

function updateHoveredSnapPoint() {
    if (!annotationMode) {
        if (hoveredSnapPoint || hoveredAnnotationId !== null) {
            hoveredSnapPoint = null;
            hoveredAnnotationId = null;
            if (typeof scheduleDraw === 'function') scheduleDraw();
        }
        return;
    }

    if (annotationMode === 'delete') {
        const nextAnnotation = findNearestAnnotation(mouseX, mouseY);
        const nextId = nextAnnotation ? nextAnnotation.id : null;
        if (hoveredAnnotationId !== nextId) {
            hoveredAnnotationId = nextId;
            if (typeof scheduleDraw === 'function') scheduleDraw();
        }
        hoveredSnapPoint = null;
        return;
    }

    const requiredLayerName = annotationMode === 'connect' && pendingConnectPoint
        ? pendingConnectPoint.layerName
        : null;
    const nextPoint = findNearestSnapPoint(mouseX, mouseY, { layerName: requiredLayerName });
    const previousId = hoveredSnapPoint ? hoveredSnapPoint.id : null;
    const nextId = nextPoint ? nextPoint.id : null;
    hoveredSnapPoint = nextPoint;
    hoveredAnnotationId = null;
    if (previousId !== nextId && typeof scheduleDraw === 'function') {
        scheduleDraw();
    }
}

function handleAnnotationCanvasClick(worldX, worldY) {
    if (!annotationMode) return false;

    if (annotationMode === 'delete') {
        return deleteAnnotationAtPoint(worldX, worldY);
    }

    const requiredLayerName = annotationMode === 'connect' && pendingConnectPoint
        ? pendingConnectPoint.layerName
        : null;
    const snapPoint = findNearestSnapPoint(worldX, worldY, { layerName: requiredLayerName });

    if (!snapPoint) {
        setAnnotationFeedback(
            requiredLayerName
                ? `Không bắt được endpoint trên layer ${requiredLayerName}.`
                : 'Điểm click chưa khớp endpoint line nào.',
            'error'
        );
        return true;
    }

    if (annotationMode === 'junction') {
        const annotation = createAnnotation('junction', snapPoint.layerName, [snapPoint], { source: 'manual', autoManaged: false });
        if (hasDuplicateAnnotation(annotation)) {
            setAnnotationFeedback('Junction này đã được gán nhãn rồi.', 'error');
            return true;
        }
        addAnnotations([annotation], { record: true });
        hoveredSnapPoint = snapPoint;
        setAnnotationFeedback(`Đã thêm junction cho layer ${snapPoint.layerName}.`, 'info');
        return true;
    }

    if (!pendingConnectPoint) {
        pendingConnectPoint = { x: snapPoint.x, y: snapPoint.y, layerName: snapPoint.layerName };
        hoveredSnapPoint = snapPoint;
        setAnnotationFeedback(`Đã chọn điểm 1 trên layer ${snapPoint.layerName}.`, 'info');
        refreshAnnotationModeLabel();
        if (typeof scheduleDraw === 'function') scheduleDraw();
        return true;
    }

    if (areSameSnapPoint(pendingConnectPoint, snapPoint)) {
        setAnnotationFeedback('Điểm thứ 2 phải khác điểm thứ 1.', 'error');
        return true;
    }

    const connectAnnotation = createAnnotation('connect', pendingConnectPoint.layerName, [pendingConnectPoint, snapPoint], { source: 'manual', autoManaged: false });
    if (hasDuplicateAnnotation(connectAnnotation)) {
        setAnnotationFeedback('Connect này đã được gán nhãn rồi.', 'error');
        return true;
    }

    const autoJunctions = createAutoJunctionsForConnect(connectAnnotation.layerName, connectAnnotation.points);
    addAnnotations([connectAnnotation, ...autoJunctions], { record: true });
    const autoMessage = autoJunctions.length ? ` và tự thêm ${autoJunctions.length} junction` : '';
    pendingConnectPoint = null;
    hoveredSnapPoint = snapPoint;
    setAnnotationFeedback(`Đã thêm connect cho layer ${connectAnnotation.layerName}${autoMessage}.`, 'info');
    refreshAnnotationModeLabel();
    return true;
}

function drawWorldPoint(targetCtx, point, color, radiusWorld) {
    targetCtx.beginPath();
    targetCtx.arc(point.x, point.y, radiusWorld, 0, Math.PI * 2);
    targetCtx.fillStyle = color;
    targetCtx.fill();
}

function drawWorldPolygon(targetCtx, polygon) {
    if (!Array.isArray(polygon) || !polygon.length) return;
    targetCtx.beginPath();
    targetCtx.moveTo(polygon[0].x, polygon[0].y);
    for (let index = 1; index < polygon.length; index += 1) {
        targetCtx.lineTo(polygon[index].x, polygon[index].y);
    }
    targetCtx.closePath();
}

function drawManualAnnotationOverlays(targetCtx) {
    if ((!manualAnnotations || !manualAnnotations.length) && !pendingConnectPoint && !hoveredSnapPoint) return;
    const radiusWorld = Math.max(3 / Math.max(zoom, 0.01), 1 / Math.max(zoom, 0.01));
    targetCtx.save();
    targetCtx.lineJoin = 'round';

    manualAnnotations.forEach(annotation => {
        if (!layerVisibility[annotation.layerName]) return;
        const polygon = getManualAnnotationWorldPolygon(annotation);
        if (!polygon) return;

        const isHovered = hoveredAnnotationId === annotation.id;
        const color = annotation.type === 'junction' ? MANUAL_LABEL_COLORS.junction : MANUAL_LABEL_COLORS.connect;
        const fillColor = annotation.type === 'junction' ? 'rgba(239, 68, 68, 0.12)' : 'rgba(14, 165, 233, 0.12)';
        targetCtx.fillStyle = isHovered && annotationMode === 'delete' ? 'rgba(245, 158, 11, 0.18)' : fillColor;
        targetCtx.strokeStyle = isHovered && annotationMode === 'delete' ? MANUAL_LABEL_COLORS.delete : color;
        targetCtx.lineWidth = 2 / Math.max(zoom, 0.01);
        if (isHovered && annotationMode === 'delete') {
            targetCtx.setLineDash([5 / Math.max(zoom, 0.01), 3 / Math.max(zoom, 0.01)]);
        }
        drawWorldPolygon(targetCtx, polygon);
        targetCtx.fill();
        drawWorldPolygon(targetCtx, polygon);
        targetCtx.stroke();
        targetCtx.setLineDash([]);

        if (annotation.type === 'connect' && annotation.points.length >= 2) {
            targetCtx.beginPath();
            targetCtx.moveTo(annotation.points[0].x, annotation.points[0].y);
            targetCtx.lineTo(annotation.points[1].x, annotation.points[1].y);
            targetCtx.stroke();
        }

        annotation.points.forEach(point => drawWorldPoint(targetCtx, point, isHovered && annotationMode === 'delete' ? MANUAL_LABEL_COLORS.delete : color, radiusWorld));
    });

    if (pendingConnectPoint && layerVisibility[pendingConnectPoint.layerName]) {
        drawWorldPoint(targetCtx, pendingConnectPoint, MANUAL_LABEL_COLORS.pending, radiusWorld * 1.2);
        targetCtx.strokeStyle = MANUAL_LABEL_COLORS.pending;
        targetCtx.lineWidth = 1.5 / Math.max(zoom, 0.01);
        targetCtx.setLineDash([4 / Math.max(zoom, 0.01), 4 / Math.max(zoom, 0.01)]);

        const previewTarget = hoveredSnapPoint && layerVisibility[hoveredSnapPoint.layerName]
            ? hoveredSnapPoint
            : { x: mouseX, y: mouseY };
        const previewPolygon = getManualAnnotationWorldPolygon({
            type: 'connect',
            points: [pendingConnectPoint, previewTarget]
        });
        if (previewPolygon) {
            targetCtx.fillStyle = 'rgba(245, 158, 11, 0.10)';
            drawWorldPolygon(targetCtx, previewPolygon);
            targetCtx.fill();
            drawWorldPolygon(targetCtx, previewPolygon);
            targetCtx.stroke();
        }

        targetCtx.beginPath();
        targetCtx.moveTo(pendingConnectPoint.x, pendingConnectPoint.y);
        if (hoveredSnapPoint && layerVisibility[hoveredSnapPoint.layerName]) {
            targetCtx.lineTo(hoveredSnapPoint.x, hoveredSnapPoint.y);
        } else {
            targetCtx.lineTo(mouseX, mouseY);
        }
        targetCtx.stroke();
        targetCtx.setLineDash([]);
    }

    if (hoveredSnapPoint && layerVisibility[hoveredSnapPoint.layerName]) {
        targetCtx.strokeStyle = MANUAL_LABEL_COLORS.snap;
        targetCtx.lineWidth = 2 / Math.max(zoom, 0.01);
        targetCtx.beginPath();
        targetCtx.arc(hoveredSnapPoint.x, hoveredSnapPoint.y, radiusWorld * 1.5, 0, Math.PI * 2);
        targetCtx.stroke();
    }

    targetCtx.restore();
}

function drawManualLabelCrosshairOverlay() {
    if (!annotationMode) return false;

    const isDeleteMode = annotationMode === 'delete';
    const anchorX = !isDeleteMode && hoveredSnapPoint ? hoveredSnapPoint.x : mouseX;
    const anchorY = !isDeleteMode && hoveredSnapPoint ? hoveredSnapPoint.y : mouseY;
    const screenX = anchorX * zoom + offsetX;
    const screenY = anchorY * zoom + offsetY;
    const lineColor = isDeleteMode ? MANUAL_LABEL_COLORS.delete : (hoveredSnapPoint ? MANUAL_LABEL_COLORS.snap : MANUAL_LABEL_COLORS.idle);

    crosshairCtx.strokeStyle = lineColor;
    crosshairCtx.lineWidth = 0.75;
    crosshairCtx.setLineDash([]);

    crosshairCtx.beginPath();
    crosshairCtx.moveTo(0, screenY);
    crosshairCtx.lineTo(crosshairCanvas.width, screenY);
    crosshairCtx.stroke();

    crosshairCtx.beginPath();
    crosshairCtx.moveTo(screenX, 0);
    crosshairCtx.lineTo(screenX, crosshairCanvas.height);
    crosshairCtx.stroke();

    if (pendingConnectPoint) {
        const pendingX = pendingConnectPoint.x * zoom + offsetX;
        const pendingY = pendingConnectPoint.y * zoom + offsetY;
        crosshairCtx.fillStyle = MANUAL_LABEL_COLORS.pending;
        crosshairCtx.beginPath();
        crosshairCtx.arc(pendingX, pendingY, 5, 0, Math.PI * 2);
        crosshairCtx.fill();

        crosshairCtx.strokeStyle = MANUAL_LABEL_COLORS.pending;
        crosshairCtx.setLineDash([6, 4]);
        crosshairCtx.beginPath();
        crosshairCtx.moveTo(pendingX, pendingY);
        crosshairCtx.lineTo(screenX, screenY);
        crosshairCtx.stroke();
        crosshairCtx.setLineDash([]);
    }

    crosshairCtx.strokeStyle = lineColor;
    crosshairCtx.beginPath();
    crosshairCtx.arc(screenX, screenY, 6, 0, Math.PI * 2);
    crosshairCtx.stroke();

    if (!isDeleteMode && hoveredSnapPoint) {
        crosshairCtx.fillStyle = lineColor;
        crosshairCtx.beginPath();
        crosshairCtx.arc(screenX, screenY, 6, 0, Math.PI * 2);
        crosshairCtx.fill();
        crosshairCtx.fillStyle = '#ffffff';
        crosshairCtx.beginPath();
        crosshairCtx.arc(screenX, screenY, 2.5, 0, Math.PI * 2);
        crosshairCtx.fill();
    }

    return true;
}

updateManualLabelUI();