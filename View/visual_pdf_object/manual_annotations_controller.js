const MANUAL_LABEL_COLORS = Object.freeze({
    junction: '#ef4444',
    connect: '#0ea5e9',
    suggested: '#22c55e',
    delete: '#f59e0b',
    pending: '#f59e0b',
    snap: '#10b981',
    idle: '#111827'
});

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
    const suggestedConnectCount = suggestedConnectAnnotations.length;
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

    if (suggestedConnectCount) {
        statusLines.push(`<div>suggest: ${suggestedConnectCount} connect • Tab để thêm nhanh</div>`);
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
        const annotationGroupKey = getConnectAnnotationGroupKey(annotation);
        const candidateGroupKey = getConnectAnnotationGroupKey(candidate);
        if (annotationGroupKey && candidateGroupKey) {
            return annotationGroupKey === candidateGroupKey;
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

function findConnectAnnotationsUsingPoint(point, layerName, excludedIds = new Set()) {
    return manualAnnotations.filter(annotation =>
        annotation.type === 'connect'
        && annotation.layerName === layerName
        && !excludedIds.has(annotation.id)
        && annotation.points.some(connectPoint => areSameSnapPoint(connectPoint, point))
    );
}

function doesAnotherConnectUsePoint(point, layerName, excludedIds = new Set()) {
    return findConnectAnnotationsUsingPoint(point, layerName, excludedIds).length > 0;
}

function addHistoryEntry(kind, annotations) {
    if (!annotations.length) return;
    manualAnnotationHistory.push({
        kind,
        annotations: annotations.map(cloneAnnotation)
    });
}

function addReplaceHistoryEntry(addedAnnotations, removedAnnotations) {
    if (!addedAnnotations.length && !removedAnnotations.length) return;
    manualAnnotationHistory.push({
        kind: 'replace',
        addedAnnotations: addedAnnotations.map(cloneAnnotation),
        removedAnnotations: removedAnnotations.map(cloneAnnotation)
    });
}

function findRedundantParentConnectIds(connectAnnotations) {
    const connectOnlyAnnotations = (connectAnnotations || []).filter(annotation => annotation?.type === 'connect');
    const redundantConnectIds = new Set();

    connectOnlyAnnotations.forEach(parentAnnotation => {
        const parentLineKeys = getConnectAnnotationLineKeys(parentAnnotation);
        if (parentLineKeys.length < 2) return;
        const parentLineKeySet = new Set(parentLineKeys);
        const childAnnotations = connectOnlyAnnotations.filter(childAnnotation => {
            if (!childAnnotation || childAnnotation.id === parentAnnotation.id) return false;
            const childLineKeys = getConnectAnnotationLineKeys(childAnnotation);
            return childLineKeys.length > 0
                && childLineKeys.length < parentLineKeys.length
                && childLineKeys.every(lineKey => parentLineKeySet.has(lineKey));
        });
        if (childAnnotations.length < 2) return;

        const coveredLineKeys = new Set();
        childAnnotations.forEach(childAnnotation => {
            getConnectAnnotationLineKeys(childAnnotation).forEach(lineKey => coveredLineKeys.add(lineKey));
        });
        if (parentLineKeys.every(lineKey => coveredLineKeys.has(lineKey))) {
            redundantConnectIds.add(parentAnnotation.id);
        }
    });

    return redundantConnectIds;
}

function doesConnectReachPoint(annotation, point) {
    if (!annotation || annotation.type !== 'connect' || !point) return false;
    const targetKey = getSnapPointKey(annotation.layerName, point.x, point.y);
    return getConnectAnnotationEndpointKeys(annotation).includes(targetKey)
        || getConnectAnnotationSegments(annotation).some(segment =>
            Array.isArray(segment)
                && segment.length >= 2
                && (areSameSnapPoint(segment[0], point) || areSameSnapPoint(segment[1], point))
        );
}

function finalizeAddedAnnotations(addedAnnotations, options = {}) {
    const existingAnnotationIds = options.existingAnnotationIds || new Set();
    const redundantConnectIds = findRedundantParentConnectIds(manualAnnotations);
    const removedExistingAnnotations = [];
    const removedNewConnectIds = new Set();

    if (redundantConnectIds.size) {
        manualAnnotations = manualAnnotations.filter(annotation => {
            if (annotation.type !== 'connect' || !redundantConnectIds.has(annotation.id)) return true;
            if (existingAnnotationIds.has(annotation.id)) {
                removedExistingAnnotations.push(cloneAnnotation(annotation));
            } else {
                removedNewConnectIds.add(annotation.id);
            }
            return false;
        });
    }

    const orphanNewJunctionIds = new Set();
    addedAnnotations.forEach(annotation => {
        if (annotation?.type !== 'junction' || !annotation.autoManaged || removedNewConnectIds.has(annotation.id)) return;
        const point = annotation.points?.[0];
        if (!point) return;
        const isStillUsed = manualAnnotations.some(existingAnnotation =>
            existingAnnotation.type === 'connect'
            && existingAnnotation.layerName === annotation.layerName
            && doesConnectReachPoint(existingAnnotation, point)
        );
        if (!isStillUsed) {
            orphanNewJunctionIds.add(annotation.id);
        }
    });

    if (orphanNewJunctionIds.size) {
        manualAnnotations = manualAnnotations.filter(annotation => !orphanNewJunctionIds.has(annotation.id));
    }

    const finalAddedAnnotations = addedAnnotations.filter(annotation =>
        !removedNewConnectIds.has(annotation.id) && !orphanNewJunctionIds.has(annotation.id)
    );

    if (options.record !== false) {
        if (removedExistingAnnotations.length) {
            addReplaceHistoryEntry(finalAddedAnnotations, removedExistingAnnotations);
        } else if (finalAddedAnnotations.length) {
            addHistoryEntry('add', finalAddedAnnotations);
        }
    }

    updateManualLabelUI();
    if (typeof scheduleDraw === 'function') scheduleDraw();

    return {
        finalAddedAnnotations,
        addedConnectAnnotations: finalAddedAnnotations.filter(annotation => annotation.type === 'connect'),
        removedExistingAnnotations
    };
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
    snapPointLineCandidates = new Map();
    snapPointLineItems = new Map();
    snapPointLineItemsByLayer = new Map();
    snapPointLineQuadtreesByLayer = new Map();
    hoveredSnapPoint = null;
    snapPointIndexReady = false;

    if (!allShapesSorted || !allShapesSorted.length) {
        snapPointIndexReady = true;
        updateManualLabelUI();
        return;
    }

    const uniquePoints = new Map();
    const uniqueLines = new Map();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    if (typeof ensureSeqnoHoverIndex === 'function' && !seqnoHoverIndexReady) {
        ensureSeqnoHoverIndex();
    }

    allShapesSorted.forEach(shape => {
        const layerName = getShapeLayerNameForField(shape, currentLayerField);
        if (!isExportableAnnotationLayer(layerName) || !Array.isArray(shape.items)) return;

        const shapeSeqnoValue = Number(shape.seqno);
        const shapeSeqno = Number.isFinite(shapeSeqnoValue) ? shapeSeqnoValue : null;
        const shapeSeqnoGroup = shapeSeqno !== null && Object.prototype.hasOwnProperty.call(seqnoGroups, shapeSeqno)
            ? seqnoGroups[shapeSeqno]
            : null;

        shape.items.forEach(item => {
            if (item[0] !== 'l') return;
            const rawPointA = Array.isArray(item[1]) ? item[1] : null;
            const rawPointB = Array.isArray(item[2]) ? item[2] : null;
            if (!rawPointA || !rawPointB || rawPointA.length < 2 || rawPointB.length < 2) return;

            const pointA = { x: Number(rawPointA[0]), y: Number(rawPointA[1]), layerName };
            const pointB = { x: Number(rawPointB[0]), y: Number(rawPointB[1]), layerName };
            if (!Number.isFinite(pointA.x) || !Number.isFinite(pointA.y) || !Number.isFinite(pointB.x) || !Number.isFinite(pointB.y)) {
                return;
            }

            [pointA, pointB].forEach(point => {
                const key = getSnapPointKey(layerName, point.x, point.y);
                if (!uniquePoints.has(key)) {
                    uniquePoints.set(key, {
                        id: key,
                        x: point.x,
                        y: point.y,
                        layerName,
                        bbox: { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y }
                    });
                    minX = Math.min(minX, point.x);
                    minY = Math.min(minY, point.y);
                    maxX = Math.max(maxX, point.x);
                    maxY = Math.max(maxY, point.y);
                }
            });

            const lineKey = createNormalizedLineKey(layerName, pointA, pointB);
            if (!uniqueLines.has(lineKey)) {
                const lineBounds = createLineCandidateBounds(pointA, pointB);
                if (!lineBounds) return;
                uniqueLines.set(lineKey, {
                    id: lineKey,
                    layerName,
                    points: [pointA, pointB],
                    bbox: lineBounds,
                    endpointKeys: [
                        getSnapPointKey(layerName, pointA.x, pointA.y),
                        getSnapPointKey(layerName, pointB.x, pointB.y)
                    ],
                    seqnos: shapeSeqno !== null ? [shapeSeqno] : [],
                    seqnoGroupIds: shapeSeqnoGroup !== null ? [shapeSeqnoGroup] : []
                });
                return;
            }

            const existingLineCandidate = uniqueLines.get(lineKey);
            if (!existingLineCandidate) return;
            if (shapeSeqno !== null && !existingLineCandidate.seqnos.includes(shapeSeqno)) {
                existingLineCandidate.seqnos.push(shapeSeqno);
            }
            if (shapeSeqnoGroup !== null && !existingLineCandidate.seqnoGroupIds.includes(shapeSeqnoGroup)) {
                existingLineCandidate.seqnoGroupIds.push(shapeSeqnoGroup);
            }
        });
    });

    snapPoints = Array.from(uniquePoints.values());

    if (!snapPoints.length || minX === Infinity) {
        snapPointIndexReady = true;
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
    const layerLineBounds = new Map();
    uniqueLines.forEach(lineCandidate => {
        snapPointLineItems.set(lineCandidate.id, lineCandidate);
        const layerLineCandidates = snapPointLineItemsByLayer.get(lineCandidate.layerName);
        if (layerLineCandidates) {
            layerLineCandidates.push(lineCandidate);
        } else {
            snapPointLineItemsByLayer.set(lineCandidate.layerName, [lineCandidate]);
        }

        const existingLayerBounds = layerLineBounds.get(lineCandidate.layerName);
        if (existingLayerBounds) {
            existingLayerBounds.minX = Math.min(existingLayerBounds.minX, lineCandidate.bbox.minX);
            existingLayerBounds.minY = Math.min(existingLayerBounds.minY, lineCandidate.bbox.minY);
            existingLayerBounds.maxX = Math.max(existingLayerBounds.maxX, lineCandidate.bbox.maxX);
            existingLayerBounds.maxY = Math.max(existingLayerBounds.maxY, lineCandidate.bbox.maxY);
        } else {
            layerLineBounds.set(lineCandidate.layerName, { ...lineCandidate.bbox });
        }

        lineCandidate.endpointKeys.forEach(endpointKey => {
            const linkedLines = snapPointLineCandidates.get(endpointKey);
            if (linkedLines) {
                linkedLines.push(lineCandidate);
            } else {
                snapPointLineCandidates.set(endpointKey, [lineCandidate]);
            }
        });
    });

    layerLineBounds.forEach((lineBounds, layerName) => {
        const layerLineCandidates = snapPointLineItemsByLayer.get(layerName);
        if (!Array.isArray(layerLineCandidates) || !layerLineCandidates.length) return;

        const layerQuadtree = new Quadtree({
            x: lineBounds.minX - padding,
            y: lineBounds.minY - padding,
            width: Math.max((lineBounds.maxX - lineBounds.minX) + padding * 2, padding * 2),
            height: Math.max((lineBounds.maxY - lineBounds.minY) + padding * 2, padding * 2)
        }, 25, 8);

        layerLineCandidates.forEach(lineCandidate => layerQuadtree.insert(lineCandidate));
        snapPointLineQuadtreesByLayer.set(layerName, layerQuadtree);
    });
    snapPointIndexReady = true;
    updateManualLabelUI();
}

function invalidateSnapPointIndex() {
    snapPoints = [];
    snapPointQuadtree = null;
    snapPointLineCandidates = new Map();
    snapPointLineItems = new Map();
    snapPointLineItemsByLayer = new Map();
    snapPointLineQuadtreesByLayer = new Map();
    hoveredSnapPoint = null;
    snapPointIndexReady = false;
    snapPointIndexBuildPromise = null;
    suggestedConnectAnnotations = [];
    updateManualLabelUI();
}

async function ensureSnapPointIndex() {
    if (snapPointIndexReady) {
        return snapPoints.length > 0;
    }
    if (snapPointIndexBuildPromise) {
        return snapPointIndexBuildPromise;
    }

    snapPointIndexBuildPromise = (async () => {
        showLoadingPopup('Preparing manual label mode...', 'Building snap points from visible drawing lines');
        await yieldToBrowser();
        rebuildSnapPointIndex();
        return snapPoints.length > 0;
    })()
        .catch(error => {
            console.error('Failed to build snap point index:', error);
            invalidateSnapPointIndex();
            return false;
        })
        .finally(() => {
            hideLoadingPopup();
            snapPointIndexBuildPromise = null;
        });

    return snapPointIndexBuildPromise;
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

function collectSuggestedConnectAnnotationsForConnects(connectAnnotations) {
    if (!Array.isArray(connectAnnotations) || !connectAnnotations.length || !(snapPointLineCandidates instanceof Map) || !snapPointLineCandidates.size) {
        return [];
    }

    const existingConnectLineKeys = collectExistingConnectLineKeys([
        ...manualAnnotations,
        ...connectAnnotations
    ]);
    const mergedSeedLineCandidates = new Map();
    collectStraightConnectSuggestionSeeds(connectAnnotations, existingConnectLineKeys).forEach(lineCandidate => {
        if (!lineCandidate) return;
        mergedSeedLineCandidates.set(lineCandidate.id, lineCandidate);
    });
    collectTeeConnectSuggestionSeeds(connectAnnotations, existingConnectLineKeys).forEach(lineCandidate => {
        if (!lineCandidate) return;
        mergedSeedLineCandidates.set(lineCandidate.id, lineCandidate);
    });

    return buildConnectSuggestionsFromSeedLines(
        Array.from(mergedSeedLineCandidates.values()),
        existingConnectLineKeys
    );
}

function acceptSuggestedConnectAnnotations() {
    if (!hasSuggestedConnectAnnotations()) return false;

    const existingConnectLineKeys = new Set();
    const existingJunctionKeys = new Set();

    manualAnnotations.forEach(annotation => {
        if (annotation.type === 'connect') {
            getConnectAnnotationLineKeys(annotation).forEach(lineKey => existingConnectLineKeys.add(lineKey));
            return;
        }
        if (annotation.type === 'junction' && Array.isArray(annotation.points) && annotation.points.length) {
            existingJunctionKeys.add(getSnapPointKey(annotation.layerName, annotation.points[0].x, annotation.points[0].y));
        }
    });

    const acceptedConnects = [];
    const acceptedJunctions = [];

    suggestedConnectAnnotations.forEach(suggestion => {
        const suggestionLineKeys = getConnectAnnotationLineKeys(suggestion);
        if (!suggestionLineKeys.length || suggestionLineKeys.every(lineKey => existingConnectLineKeys.has(lineKey))) return;

        const connectAnnotation = createAnnotation('connect', suggestion.layerName, suggestion.points, {
            source: 'manual',
            autoManaged: false,
            lineKeys: suggestionLineKeys,
            segments: getConnectAnnotationSegments(suggestion)
        });
        acceptedConnects.push(connectAnnotation);
        suggestionLineKeys.forEach(lineKey => existingConnectLineKeys.add(lineKey));

        connectAnnotation.points.forEach(point => {
            const junctionKey = getSnapPointKey(connectAnnotation.layerName, point.x, point.y);
            if (existingJunctionKeys.has(junctionKey)) return;
            acceptedJunctions.push(createAnnotation('junction', connectAnnotation.layerName, [point], {
                source: 'auto',
                autoManaged: true
            }));
            existingJunctionKeys.add(junctionKey);
        });
    });

    if (!acceptedConnects.length) {
        clearSuggestedConnectAnnotations({ redraw: false });
        setAnnotationFeedback('Không có connect gợi ý mới để thêm.', 'info');
        return true;
    }

    const existingAnnotationIds = new Set(manualAnnotations.map(annotation => annotation.id));
    const addedAnnotations = addAnnotations([...acceptedConnects, ...acceptedJunctions], { record: false });
    const finalizationResult = finalizeAddedAnnotations(addedAnnotations, {
        existingAnnotationIds,
        record: true
    });
    const nextSuggestions = collectSuggestedConnectAnnotationsForConnects(finalizationResult.addedConnectAnnotations);
    setSuggestedConnectAnnotations(nextSuggestions, { redraw: false });
    const nextSuggestionMessage = nextSuggestions.length
        ? ` Còn ${nextSuggestions.length} gợi ý nữa, nhấn Tab để thêm tiếp.`
        : '';
    setAnnotationFeedback(
        `Đã thêm ${finalizationResult.addedConnectAnnotations.length} connect và ${finalizationResult.finalAddedAnnotations.filter(annotation => annotation.type === 'junction').length} junction từ gợi ý.${nextSuggestionMessage}`,
        'info'
    );
    refreshAnnotationModeLabel();
    if (typeof scheduleDraw === 'function') scheduleDraw();
    return true;
}

function deactivateManualLabelMode(options = {}) {
    annotationMode = null;
    hoveredSnapPoint = null;
    hoveredAnnotationId = null;
    suggestedConnectAnnotations = [];
    if (options.clearPending !== false) {
        pendingConnectPoint = null;
    }
    canvasContainer.classList.remove('annotation-junction-mode', 'annotation-connect-mode', 'annotation-delete-mode');
    refreshAnnotationModeLabel();
    updateManualLabelUI();
    if (typeof scheduleDraw === 'function') scheduleDraw();
}

async function setAnnotationMode(mode) {
    if (!jsonShapes || !jsonShapes.length) {
        setAnnotationFeedback('Chưa có dữ liệu để gán nhãn.', 'error');
        return;
    }

    if ((mode === 'junction' || mode === 'connect') && !snapPointIndexReady) {
        await ensureSnapPointIndex();
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
        btnAIExtract.textContent = UI_TEXT.VLM_EXTRACT;
        btnAIExtract.classList.remove('active');
        canvasContainer.classList.remove('vlm-bbox-mode');
    }

    annotationMode = mode;
    pendingConnectPoint = null;
    suggestedConnectAnnotations = [];
    hoveredSnapPoint = mode === 'delete' ? null : findNearestSnapPoint(mouseX, mouseY);
    hoveredAnnotationId = mode === 'delete' ? (findNearestAnnotation(mouseX, mouseY)?.id || null) : null;
    canvasContainer.classList.toggle('annotation-junction-mode', mode === 'junction');
    canvasContainer.classList.toggle('annotation-connect-mode', mode === 'connect');
    canvasContainer.classList.toggle('annotation-delete-mode', mode === 'delete');

    if (mode === 'connect') {
        setAnnotationFeedback('Chọn điểm 1 cho connect. Hệ thống sẽ gộp line hợp lệ và thêm junction ở mọi đầu mút của connect.', 'info');
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
    suggestedConnectAnnotations = [];
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
    suggestedConnectAnnotations = [];
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
    if (action.kind === 'add') {
        const annotationIds = action.annotations.map(annotation => annotation.id);
        removeAnnotationsByIds(annotationIds, { record: false });
        setAnnotationFeedback('Đã undo thao tác thêm nhãn gần nhất.', 'info');
    } else if (action.kind === 'delete') {
        addAnnotations(action.annotations, { record: false });
        setAnnotationFeedback('Đã khôi phục nhãn vừa xóa.', 'info');
    } else if (action.kind === 'replace') {
        const addedAnnotationIds = (action.addedAnnotations || []).map(annotation => annotation.id);
        removeAnnotationsByIds(addedAnnotationIds, { record: false });
        addAnnotations(action.removedAnnotations || [], { record: false });
        setAnnotationFeedback('Đã undo thao tác cập nhật connect và khôi phục connect cũ.', 'info');
    }
    refreshAnnotationModeLabel();
}

function clearManualAnnotations() {
    if (!manualAnnotations.length && !pendingConnectPoint) return;
    resetManualLabelState({ clearMode: false, message: 'Đã xóa toàn bộ nhãn thủ công.', tone: 'info' });
}

function createAutoJunctionsForConnect(layerName, points, connectAnnotation = null) {
    return points
        .filter(point => !findMatchingJunctionAtPoint(point, layerName))
        .map(point => createAnnotation('junction', layerName, [point], { source: 'auto', autoManaged: true }));
}

function collectCascadeDeleteAnnotations(targetAnnotation) {
    if (!targetAnnotation) return [];

    const cascadeById = new Map();
    const addToCascade = annotation => {
        if (!annotation || cascadeById.has(annotation.id)) return;
        cascadeById.set(annotation.id, annotation);
    };

    if (targetAnnotation.type === 'junction') {
        addToCascade(targetAnnotation);
        const attachedConnects = findConnectAnnotationsUsingPoint(targetAnnotation.points[0], targetAnnotation.layerName);
        const excludedConnectIds = new Set(attachedConnects.map(annotation => annotation.id));

        attachedConnects.forEach(connectAnnotation => {
            addToCascade(connectAnnotation);
        });

        attachedConnects.forEach(connectAnnotation => {
            connectAnnotation.points.forEach(point => {
                const junction = findMatchingJunctionAtPoint(point, connectAnnotation.layerName);
                if (!junction || !junction.autoManaged) return;
                if (junction.id === targetAnnotation.id || !doesAnotherConnectUsePoint(point, connectAnnotation.layerName, excludedConnectIds)) {
                    addToCascade(junction);
                }
            });
        });

        return Array.from(cascadeById.values());
    }

    addToCascade(targetAnnotation);
    const excludedConnectIds = new Set([targetAnnotation.id]);
    targetAnnotation.points.forEach(point => {
        const junction = findMatchingJunctionAtPoint(point, targetAnnotation.layerName);
        if (!junction || !junction.autoManaged) return;
        if (!doesAnotherConnectUsePoint(point, targetAnnotation.layerName, excludedConnectIds)) {
            addToCascade(junction);
        }
    });
    return Array.from(cascadeById.values());
}

function deleteAnnotationAtPoint(worldX, worldY) {
    const annotation = findNearestAnnotation(worldX, worldY);
    if (!annotation) {
        setAnnotationFeedback('Không có label nào ở vị trí click để xóa.', 'error');
        return true;
    }

    const cascade = collectCascadeDeleteAnnotations(annotation);
    if (!cascade.length) return true;
    suggestedConnectAnnotations = [];
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
        suggestedConnectAnnotations = [];
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

    const connectAnnotation = createConnectAnnotationFromLineCandidates([{
        id: createNormalizedLineKey(pendingConnectPoint.layerName, pendingConnectPoint, snapPoint),
        layerName: pendingConnectPoint.layerName,
        points: [pendingConnectPoint, snapPoint],
        endpointKeys: [
            getSnapPointKey(pendingConnectPoint.layerName, pendingConnectPoint.x, pendingConnectPoint.y),
            getSnapPointKey(pendingConnectPoint.layerName, snapPoint.x, snapPoint.y)
        ]
    }], {
        source: 'manual',
        autoManaged: false
    });
    if (!connectAnnotation) {
        setAnnotationFeedback('Không tạo được connect từ line vừa chọn.', 'error');
        return true;
    }
    if (hasDuplicateAnnotation(connectAnnotation)) {
        setAnnotationFeedback('Connect này đã được gán nhãn rồi.', 'error');
        return true;
    }

    const autoJunctions = createAutoJunctionsForConnect(connectAnnotation.layerName, connectAnnotation.points, connectAnnotation);
    const existingAnnotationIds = new Set(manualAnnotations.map(annotation => annotation.id));
    const addedAnnotations = addAnnotations([connectAnnotation, ...autoJunctions], { record: false });
    const finalizationResult = finalizeAddedAnnotations(addedAnnotations, {
        existingAnnotationIds,
        record: true
    });
    const survivingConnects = finalizationResult.addedConnectAnnotations;
    const suggestedConnects = collectSuggestedConnectAnnotationsForConnects(survivingConnects);
    setSuggestedConnectAnnotations(suggestedConnects, { redraw: false });
    const addedJunctionCount = finalizationResult.finalAddedAnnotations.filter(annotation => annotation.type === 'junction').length;
    const autoMessage = addedJunctionCount ? ` và tự thêm ${addedJunctionCount} junction` : '';
    const suggestionMessage = suggestedConnects.length
        ? ` Đề xuất ${suggestedConnects.length} connect lân cận, nhấn Tab để thêm nhanh.`
        : '';
    pendingConnectPoint = null;
    hoveredSnapPoint = snapPoint;
    if (!survivingConnects.length) {
        setAnnotationFeedback(`Connect lớn bị loại vì đã có các connect con bao phủ.${suggestionMessage}`, 'info');
    } else {
        setAnnotationFeedback(`Đã thêm connect cho layer ${connectAnnotation.layerName}${autoMessage}.${suggestionMessage}`, 'info');
    }
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
    if ((!manualAnnotations || !manualAnnotations.length) && !pendingConnectPoint && !hoveredSnapPoint && !hasSuggestedConnectAnnotations()) return;
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

        if (annotation.type === 'connect') {
            const connectSegments = getConnectAnnotationSegments(annotation);
            connectSegments.forEach(segment => {
                if (!Array.isArray(segment) || segment.length < 2) return;
                targetCtx.beginPath();
                targetCtx.moveTo(segment[0].x, segment[0].y);
                targetCtx.lineTo(segment[1].x, segment[1].y);
                targetCtx.stroke();
            });
        }

        annotation.points.forEach(point => drawWorldPoint(targetCtx, point, isHovered && annotationMode === 'delete' ? MANUAL_LABEL_COLORS.delete : color, radiusWorld));
    });

    suggestedConnectAnnotations.forEach(annotation => {
        if (!layerVisibility[annotation.layerName]) return;
        const polygon = getManualAnnotationWorldPolygon(annotation);
        if (!polygon) return;

        targetCtx.fillStyle = 'rgba(34, 197, 94, 0.08)';
        targetCtx.strokeStyle = MANUAL_LABEL_COLORS.suggested;
        targetCtx.lineWidth = 1.5 / Math.max(zoom, 0.01);
        targetCtx.setLineDash([5 / Math.max(zoom, 0.01), 3 / Math.max(zoom, 0.01)]);
        drawWorldPolygon(targetCtx, polygon);
        targetCtx.fill();
        drawWorldPolygon(targetCtx, polygon);
        targetCtx.stroke();

        const connectSegments = getConnectAnnotationSegments(annotation);
        connectSegments.forEach(segment => {
            if (!Array.isArray(segment) || segment.length < 2) return;
            targetCtx.beginPath();
            targetCtx.moveTo(segment[0].x, segment[0].y);
            targetCtx.lineTo(segment[1].x, segment[1].y);
            targetCtx.stroke();
        });

        annotation.points.forEach(point => drawWorldPoint(targetCtx, point, MANUAL_LABEL_COLORS.suggested, radiusWorld * 0.9));
        targetCtx.setLineDash([]);
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