const MANUAL_LABEL_COLORS = Object.freeze({
    junction: '#ef4444',
    connect: '#0ea5e9',
    suggested: '#22c55e',
    pairCheckSelected: '#7c3aed',
    pairCheckHover: '#8b5cf6',
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

function syncPairCheckState() {
    const connectIdSet = new Set(
        manualAnnotations
            .filter(annotation => annotation?.type === 'connect')
            .map(annotation => annotation.id)
    );
    pairCheckSelectionIds = pairCheckSelectionIds.filter(annotationId => connectIdSet.has(annotationId));
    if (pairCheckSelectionIds.length < 2) {
        pairCheckLastReport = null;
    }
}

function resetPairCheckState() {
    pairCheckSelectionIds = [];
    pairCheckLastReport = null;
}

function getPairCheckSelectionAnnotations() {
    if (!Array.isArray(pairCheckSelectionIds) || !pairCheckSelectionIds.length) return [];
    const annotationsById = new Map(manualAnnotations.map(annotation => [annotation.id, annotation]));
    return pairCheckSelectionIds
        .map(annotationId => annotationsById.get(annotationId))
        .filter(annotation => annotation?.type === 'connect');
}

function getConnectAnnotationDisplayLabel(annotation) {
    if (!annotation) return 'connect ?';
    return `#${annotation.id} • ${annotation.layerName}`;
}

function getPairCheckDirectionLabel(direction, annotationA, annotationB) {
    const sourceAnnotation = direction?.sourceId === annotationA?.id ? annotationA : annotationB;
    const targetAnnotation = direction?.targetId === annotationA?.id ? annotationA : annotationB;
    return `${getConnectAnnotationDisplayLabel(sourceAnnotation)} -> ${getConnectAnnotationDisplayLabel(targetAnnotation)}`;
}

function getPairCheckDirectionReasonLines(direction) {
    if (!direction || direction.isValid) return [];
    const reasonLines = [];
    if (Array.isArray(direction.straight?.reasons) && direction.straight.reasons.length) {
        reasonLines.push(`straight: ${direction.straight.reasons.join(' | ')}`);
    }
    if (Array.isArray(direction.tee?.reasons) && direction.tee.reasons.length) {
        reasonLines.push(`tee: ${direction.tee.reasons.join(' | ')}`);
    }
    return reasonLines;
}

function buildPairCheckFeedbackMessage(pairReport, annotationA, annotationB) {
    if (!pairReport) {
        return 'Không kiểm tra được cặp connect đã chọn.';
    }

    const validDirections = pairReport.directions
        .filter(direction => direction.isValid)
        .map(direction => `${getPairCheckDirectionLabel(direction, annotationA, annotationB)} [${direction.matchedPath}]`);

    if (pairReport.isMutualSuggestion) {
        return `Cặp connect đạt điều kiện gợi ý 2 chiều. ${validDirections.join(' | ')}`;
    }
    if (pairReport.hasAnySuggestion) {
        return `Cặp connect đạt ${validDirections.length}/2 chiều gợi ý. ${validDirections.join(' | ')}. Các điều kiện fail được liệt kê ngay bên dưới với ref #sym:... và cũng có trong console.`;
    }
    return 'Cặp connect chưa đủ điều kiện gợi ý. Các điều kiện fail được liệt kê ngay bên dưới với ref #sym:... và cũng có trong console.';
}

function logConnectPairCheckReport(pairReport, annotationA, annotationB) {
    if (!pairReport || typeof console === 'undefined') return;
    const pairLabel = `${getConnectAnnotationDisplayLabel(annotationA)} <-> ${getConnectAnnotationDisplayLabel(annotationB)}`;
    console.groupCollapsed(`[manual pair-check] ${pairLabel}`);
    pairReport.directions.forEach(direction => {
        const directionLabel = getPairCheckDirectionLabel(direction, annotationA, annotationB);
        console.group(`${directionLabel} : ${direction.isValid ? 'PASS' : 'FAIL'}`);
        console.log('matchedPath', direction.matchedPath);
        console.log('straight', direction.straight);
        console.log('tee', direction.tee);
        console.groupEnd();
    });
    console.groupEnd();
}

function getActionHistoryDepth() {
    return manualAnnotationHistory.length + (pendingConnectPoint ? 1 : 0);
}

function updateManualLabelUI() {
    syncPairCheckState();
    const pairCheckSelectionAnnotations = getPairCheckSelectionAnnotations();
    const pairCheckSelectionCount = pairCheckSelectionAnnotations.length;
    let pairCheckConnectCount = 0;
    let autoJunctionCount = 0;
    manualAnnotations.forEach(annotation => {
        if (annotation.type === 'connect') {
            pairCheckConnectCount += 1;
        } else if (annotation.type === 'junction' && annotation.autoManaged) {
            autoJunctionCount += 1;
        }
    });

    if (btnLabelJunction) btnLabelJunction.classList.toggle('active', annotationMode === 'junction');
    if (btnLabelConnect) btnLabelConnect.classList.toggle('active', annotationMode === 'connect');
    if (btnCheckConnectPair) {
        btnCheckConnectPair.classList.toggle('active', annotationMode === 'pair-check');
        btnCheckConnectPair.disabled = pairCheckConnectCount < 2;
    }
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
    } else if (annotationMode === 'pair-check') {
        if (pairCheckSelectionCount === 0) {
            statusLines.push('<div>mode: pair-check • chọn connect 1</div>');
        } else if (pairCheckSelectionCount === 1) {
            statusLines.push('<div>mode: pair-check • chọn connect 2</div>');
        } else {
            statusLines.push('<div>mode: pair-check • đã chọn 2 connect</div>');
        }
    } else if (annotationMode === 'delete') {
        statusLines.push('<div>mode: delete</div>');
    } else {
        statusLines.push('<div>mode: off</div>');
    }

    if (pairCheckSelectionCount) {
        statusLines.push(`<div>pair-check: ${pairCheckSelectionCount}/2 selected • ${pairCheckSelectionAnnotations.map(annotation => escapeHtml(getConnectAnnotationDisplayLabel(annotation))).join(' | ')}</div>`);
    }
    if (pairCheckLastReport) {
        const pairSummary = pairCheckLastReport.isMutualSuggestion
            ? 'pair-check: 2/2 chiều đạt'
            : pairCheckLastReport.hasAnySuggestion
                ? 'pair-check: 1/2 chiều đạt'
                : 'pair-check: 0/2 chiều đạt';
        statusLines.push(`<div>${escapeHtml(pairSummary)}</div>`);

        const [annotationA, annotationB] = pairCheckSelectionAnnotations;
        pairCheckLastReport.directions
            .filter(direction => !direction.isValid)
            .forEach(direction => {
                statusLines.push(`<div class="manual-label-pair-detail"><strong>${escapeHtml(getPairCheckDirectionLabel(direction, annotationA, annotationB))}</strong></div>`);
                getPairCheckDirectionReasonLines(direction).forEach(reasonLine => {
                    statusLines.push(`<div class="manual-label-pair-detail">${escapeHtml(reasonLine)}</div>`);
                });
            });
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

function getJunctionDuplicateKey(annotation) {
    const point = annotation?.points?.[0];
    if (!annotation?.layerName || !point) return null;
    return getSnapPointKey(annotation.layerName, point.x, point.y);
}

function getConnectEndpointDuplicateKey(annotation) {
    if (!annotation?.layerName || !Array.isArray(annotation.points) || annotation.points.length < 2) return null;
    return annotation.points
        .slice(0, 2)
        .map(point => getSnapPointKey(annotation.layerName, point.x, point.y))
        .sort()
        .join('||');
}

function addAnnotationToDuplicateIndex(annotation, duplicateIndex) {
    if (!annotation || !duplicateIndex) return;
    if (annotation.type === 'junction') {
        const junctionKey = getJunctionDuplicateKey(annotation);
        if (junctionKey) duplicateIndex.junctionKeys.add(junctionKey);
        return;
    }

    if (annotation.type !== 'connect') return;
    const groupKey = getConnectAnnotationGroupKey(annotation);
    const endpointKey = getConnectEndpointDuplicateKey(annotation);
    if (groupKey) {
        duplicateIndex.connectGroupKeys.add(`${annotation.layerName}::${groupKey}`);
    } else if (endpointKey) {
        duplicateIndex.connectEndpointKeysWithoutGroup.add(`${annotation.layerName}::${endpointKey}`);
    }
    if (endpointKey) {
        duplicateIndex.connectEndpointKeysAll.add(`${annotation.layerName}::${endpointKey}`);
    }
}

function buildAnnotationDuplicateIndex(annotations) {
    const duplicateIndex = {
        junctionKeys: new Set(),
        connectGroupKeys: new Set(),
        connectEndpointKeysAll: new Set(),
        connectEndpointKeysWithoutGroup: new Set()
    };
    (annotations || []).forEach(annotation => addAnnotationToDuplicateIndex(annotation, duplicateIndex));
    return duplicateIndex;
}

function hasDuplicateAnnotationInIndex(candidate, duplicateIndex) {
    if (!candidate || !duplicateIndex) return false;
    if (candidate.type === 'junction') {
        const junctionKey = getJunctionDuplicateKey(candidate);
        return Boolean(junctionKey && duplicateIndex.junctionKeys.has(junctionKey));
    }
    if (candidate.type !== 'connect') return false;

    const groupKey = getConnectAnnotationGroupKey(candidate);
    const endpointKey = getConnectEndpointDuplicateKey(candidate);
    if (groupKey && duplicateIndex.connectGroupKeys.has(`${candidate.layerName}::${groupKey}`)) {
        return true;
    }
    if (endpointKey) {
        const layerEndpointKey = `${candidate.layerName}::${endpointKey}`;
        return groupKey
            ? duplicateIndex.connectEndpointKeysWithoutGroup.has(layerEndpointKey)
            : duplicateIndex.connectEndpointKeysAll.has(layerEndpointKey);
    }
    return false;
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

function invalidateManualAnnotationSpatialIndex() {
    manualAnnotationSpatialIndex = null;
    manualAnnotationSpatialIndexReady = false;
}

function getManualAnnotationSpatialBbox(annotation) {
    const rect = getManualAnnotationWorldRect(annotation);
    if (!rect) return null;
    return {
        minX: rect.x,
        minY: rect.y,
        maxX: rect.x + rect.width,
        maxY: rect.y + rect.height
    };
}

function ensureManualAnnotationSpatialIndex() {
    if (manualAnnotationSpatialIndexReady) return;
    manualAnnotationSpatialIndex = null;
    manualAnnotationSpatialIndexReady = true;

    if (!Array.isArray(manualAnnotations) || !manualAnnotations.length) return;

    const indexedAnnotations = [];
    let bounds = null;
    manualAnnotations.forEach(annotation => {
        const bbox = getManualAnnotationSpatialBbox(annotation);
        if (!bbox) return;
        indexedAnnotations.push({ annotation, bbox });
        bounds = bounds
            ? {
                minX: Math.min(bounds.minX, bbox.minX),
                minY: Math.min(bounds.minY, bbox.minY),
                maxX: Math.max(bounds.maxX, bbox.maxX),
                maxY: Math.max(bounds.maxY, bbox.maxY)
            }
            : { ...bbox };
    });

    if (!indexedAnnotations.length || !bounds) return;

    const padding = getAnnotationSnapToleranceWorld();
    manualAnnotationSpatialIndex = new Quadtree({
        x: bounds.minX - padding,
        y: bounds.minY - padding,
        width: Math.max((bounds.maxX - bounds.minX) + padding * 2, padding * 2),
        height: Math.max((bounds.maxY - bounds.minY) + padding * 2, padding * 2)
    }, 25, 8);

    indexedAnnotations.forEach(item => manualAnnotationSpatialIndex.insert(item));
}

function queryManualAnnotationsNearPoint(worldX, worldY, type = null) {
    const worldTolerance = getAnnotationSnapToleranceWorld();
    ensureManualAnnotationSpatialIndex();

    if (!manualAnnotationSpatialIndex) {
        return manualAnnotations.filter(annotation => !type || annotation?.type === type);
    }

    const queryRange = {
        minX: worldX - worldTolerance,
        minY: worldY - worldTolerance,
        maxX: worldX + worldTolerance,
        maxY: worldY + worldTolerance
    };

    return Array.from(new Set(
        manualAnnotationSpatialIndex
            .query(queryRange)
            .map(item => item.annotation)
            .filter(annotation => annotation && (!type || annotation.type === type))
    ));
}

function getConnectAnnotationLineLikeCandidates(annotation) {
    const lineCandidates = getConnectAnnotationLineKeys(annotation)
        .map(lineKey => snapPointLineItems.get(lineKey))
        .filter(Boolean);
    if (lineCandidates.length) {
        return lineCandidates;
    }

    return getConnectAnnotationSegments(annotation)
        .filter(segment => Array.isArray(segment) && segment.length >= 2)
        .map((segment, segmentIndex) => ({
            id: `segment:${annotation.id}:${segmentIndex}`,
            layerName: annotation.layerName,
            points: segment.map(cloneAnnotationPoint),
            endpointKeys: segment.map(point => getSnapPointKey(annotation.layerName, point.x, point.y))
        }));
}

function isStraightParallelConnectAnnotation(annotation) {
    if (!annotation || annotation.type !== 'connect') return false;
    const lineCandidates = getConnectAnnotationLineLikeCandidates(annotation);
    if (lineCandidates.length < 2) return false;

    const referenceLineCandidate = getReferenceLineCandidateForAnnotation(annotation);
    if (!referenceLineCandidate) return false;
    return lineCandidates.every(lineCandidate => areParallelLineCandidates(referenceLineCandidate, lineCandidate));
}

function shouldPreferMergedStraightConnect(parentAnnotation, childAnnotations) {
    if (!isStraightParallelConnectAnnotation(parentAnnotation)) return false;
    const parentReferenceLineCandidate = getReferenceLineCandidateForAnnotation(parentAnnotation);
    if (!parentReferenceLineCandidate) return false;

    return childAnnotations.every(childAnnotation => {
        if (!childAnnotation || childAnnotation.type !== 'connect') return false;
        const childReferenceLineCandidate = getReferenceLineCandidateForAnnotation(childAnnotation);
        return childReferenceLineCandidate && areParallelLineCandidates(parentReferenceLineCandidate, childReferenceLineCandidate);
    });
}

function findRedundantConnectIds(connectAnnotations) {
    const connectOnlyAnnotations = (connectAnnotations || []).filter(annotation => annotation?.type === 'connect');
    const redundantConnectIds = new Set();
    const boundsTolerance = getManualEndpointTouchToleranceWorld();
    const connectEntries = connectOnlyAnnotations.map(annotation => {
        const lineKeys = getConnectAnnotationLineKeys(annotation);
        return {
            annotation,
            lineKeys,
            lineKeySet: new Set(lineKeys),
            bounds: getConnectAnnotationSearchBounds(annotation, 0)
        };
    });
    const entriesByLayer = new Map();
    connectEntries.forEach(entry => {
        const layerEntries = entriesByLayer.get(entry.annotation.layerName);
        if (layerEntries) {
            layerEntries.push(entry);
        } else {
            entriesByLayer.set(entry.annotation.layerName, [entry]);
        }
    });

    const canParentBoundsCoverChild = (parentEntry, childEntry) => {
        if (!parentEntry?.bounds || !childEntry?.bounds) return true;
        return doBoundsIntersect(expandBounds(parentEntry.bounds, boundsTolerance), childEntry.bounds);
    };

    connectEntries.forEach(parentEntry => {
        const parentAnnotation = parentEntry.annotation;
        if (!parentAnnotation || redundantConnectIds.has(parentAnnotation.id)) return;
        const layerEntries = entriesByLayer.get(parentAnnotation.layerName) || [];
        const parentLineKeys = parentEntry.lineKeys;
        if (parentLineKeys.length >= 2) {
            const parentLineKeySet = parentEntry.lineKeySet;
            const childEntries = layerEntries.filter(childEntry => {
                const childAnnotation = childEntry.annotation;
                if (!childAnnotation || childAnnotation.id === parentAnnotation.id || redundantConnectIds.has(childAnnotation.id)) return false;
                const childLineKeys = childEntry.lineKeys;
                return childLineKeys.length > 0
                    && childLineKeys.length < parentLineKeys.length
                    && childLineKeys.every(lineKey => parentLineKeySet.has(lineKey));
            });
            const childAnnotations = childEntries.map(childEntry => childEntry.annotation);

            if (childAnnotations.length >= 2) {
                const coveredLineKeys = new Set();
                childEntries.forEach(childEntry => {
                    childEntry.lineKeys.forEach(lineKey => coveredLineKeys.add(lineKey));
                });
                if (parentLineKeys.every(lineKey => coveredLineKeys.has(lineKey))) {
                    if (shouldPreferMergedStraightConnect(parentAnnotation, childAnnotations)) {
                        childAnnotations.forEach(childAnnotation => redundantConnectIds.add(childAnnotation.id));
                        return;
                    }
                    redundantConnectIds.add(parentAnnotation.id);
                    return;
                }
            }
        }

        layerEntries.forEach(childEntry => {
            const childAnnotation = childEntry.annotation;
            if (!childAnnotation || childAnnotation.id === parentAnnotation.id || redundantConnectIds.has(childAnnotation.id)) return;
            if (!canParentBoundsCoverChild(parentEntry, childEntry)) return;
            if (doesConnectAnnotationGeometricallyCover(parentAnnotation, childAnnotation)) {
                redundantConnectIds.add(childAnnotation.id);
            }
        });
    });

    return redundantConnectIds;
}

function doesConnectReachPoint(annotation, point) {
    if (!annotation || annotation.type !== 'connect' || !point) return false;
    return Array.isArray(annotation.points)
        && annotation.points.some(connectPoint => areSameSnapPoint(connectPoint, point));
}

function finalizeAddedAnnotations(addedAnnotations, options = {}) {
    const existingAnnotationIds = options.existingAnnotationIds || new Set();
    const redundantConnectIds = findRedundantConnectIds(manualAnnotations);
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

    const orphanAutoJunctionIds = new Set();
    manualAnnotations.forEach(annotation => {
        if (annotation?.type !== 'junction' || !annotation.autoManaged) return;
        const point = annotation.points?.[0];
        if (!point) return;
        const isStillUsed = manualAnnotations.some(existingAnnotation =>
            existingAnnotation.type === 'connect'
            && existingAnnotation.layerName === annotation.layerName
            && doesConnectReachPoint(existingAnnotation, point)
        );
        if (!isStillUsed) {
            if (existingAnnotationIds.has(annotation.id)) {
                removedExistingAnnotations.push(cloneAnnotation(annotation));
            }
            orphanAutoJunctionIds.add(annotation.id);
        }
    });

    if (orphanAutoJunctionIds.size) {
        manualAnnotations = manualAnnotations.filter(annotation => !orphanAutoJunctionIds.has(annotation.id));
    }

    const finalAddedAnnotations = addedAnnotations.filter(annotation =>
        !removedNewConnectIds.has(annotation.id) && !orphanAutoJunctionIds.has(annotation.id)
    );

    if (options.record !== false) {
        if (removedExistingAnnotations.length) {
            addReplaceHistoryEntry(finalAddedAnnotations, removedExistingAnnotations);
        } else if (finalAddedAnnotations.length) {
            addHistoryEntry('add', finalAddedAnnotations);
        }
    }

    if (finalAddedAnnotations.length || removedExistingAnnotations.length || removedNewConnectIds.size || orphanAutoJunctionIds.size) {
        invalidateManualAnnotationSpatialIndex();
    }
    if (options.updateUi !== false) {
        updateManualLabelUI();
        if (typeof scheduleDraw === 'function') scheduleDraw();
    }

    return {
        finalAddedAnnotations,
        addedConnectAnnotations: finalAddedAnnotations.filter(annotation => annotation.type === 'connect'),
        removedExistingAnnotations
    };
}

function addAnnotations(annotations, options = {}) {
    const added = [];
    const duplicateIndex = buildAnnotationDuplicateIndex(manualAnnotations);
    annotations.forEach(annotation => {
        if (hasDuplicateAnnotationInIndex(annotation, duplicateIndex)) return;
        manualAnnotations.push(cloneAnnotation(annotation));
        added.push(annotation);
        addAnnotationToDuplicateIndex(annotation, duplicateIndex);
    });
    if (options.record !== false && added.length) {
        addHistoryEntry('add', added);
    }
    if (added.length) {
        invalidateManualAnnotationSpatialIndex();
    }
    if (options.updateUi !== false) {
        updateManualLabelUI();
        if (typeof scheduleDraw === 'function') scheduleDraw();
    }
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
    invalidateManualAnnotationSpatialIndex();
    updateManualLabelUI();
    if (typeof scheduleDraw === 'function') scheduleDraw();
    return removed;
}

async function rebuildSnapPointIndex() {
    const buildToken = snapPointIndexBuildToken;
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
        return true;
    }

    const uniquePoints = new Map();
    const uniqueLines = new Map();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    if (typeof ensureSeqnoHoverIndexAsync === 'function' && !seqnoHoverIndexReady) {
        await ensureSeqnoHoverIndexAsync();
        if (buildToken !== snapPointIndexBuildToken) return false;
    } else if (typeof ensureSeqnoHoverIndex === 'function' && !seqnoHoverIndexReady) {
        ensureSeqnoHoverIndex();
    }

    let processedItems = 0;
    let lastYieldTime = performance.now();
    for (const shape of allShapesSorted) {
        const layerName = getShapeLayerNameForField(shape, currentLayerField);
        if (!isExportableAnnotationLayer(layerName) || layerVisibility?.[layerName] === false || !Array.isArray(shape.items)) continue;

        const shapeSeqnoValue = Number(shape.seqno);
        const shapeSeqno = Number.isFinite(shapeSeqnoValue) ? shapeSeqnoValue : null;
        const shapeSeqnoGroup = shapeSeqno !== null && Object.prototype.hasOwnProperty.call(seqnoGroups, shapeSeqno)
            ? seqnoGroups[shapeSeqno]
            : null;

        for (const item of shape.items) {
            processedItems += 1;
            if (item[0] !== 'l') {
                if (processedItems % 1500 === 0 && performance.now() - lastYieldTime > 8) {
                    await yieldToBrowser();
                    if (buildToken !== snapPointIndexBuildToken) return false;
                    lastYieldTime = performance.now();
                }
                continue;
            }
            const rawPointA = Array.isArray(item[1]) ? item[1] : null;
            const rawPointB = Array.isArray(item[2]) ? item[2] : null;
            if (!rawPointA || !rawPointB || rawPointA.length < 2 || rawPointB.length < 2) continue;

            const pointA = { x: Number(rawPointA[0]), y: Number(rawPointA[1]), layerName };
            const pointB = { x: Number(rawPointB[0]), y: Number(rawPointB[1]), layerName };
            if (!Number.isFinite(pointA.x) || !Number.isFinite(pointA.y) || !Number.isFinite(pointB.x) || !Number.isFinite(pointB.y)) {
                continue;
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
                if (!lineBounds) continue;
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
                if (processedItems % 1500 === 0 && performance.now() - lastYieldTime > 8) {
                    await yieldToBrowser();
                    if (buildToken !== snapPointIndexBuildToken) return false;
                    lastYieldTime = performance.now();
                }
                continue;
            }

            const existingLineCandidate = uniqueLines.get(lineKey);
            if (!existingLineCandidate) continue;
            if (shapeSeqno !== null && !existingLineCandidate.seqnos.includes(shapeSeqno)) {
                existingLineCandidate.seqnos.push(shapeSeqno);
            }
            if (shapeSeqnoGroup !== null && !existingLineCandidate.seqnoGroupIds.includes(shapeSeqnoGroup)) {
                existingLineCandidate.seqnoGroupIds.push(shapeSeqnoGroup);
            }
            if (processedItems % 1500 === 0 && performance.now() - lastYieldTime > 8) {
                await yieldToBrowser();
                if (buildToken !== snapPointIndexBuildToken) return false;
                lastYieldTime = performance.now();
            }
        }
    }

    if (buildToken !== snapPointIndexBuildToken) return false;

    snapPoints = Array.from(uniquePoints.values());

    if (!snapPoints.length || minX === Infinity) {
        snapPointIndexReady = true;
        updateManualLabelUI();
        return true;
    }

    if (buildToken !== snapPointIndexBuildToken) return false;

    const padding = 10;
    snapPointQuadtree = new Quadtree({
        x: minX - padding,
        y: minY - padding,
        width: Math.max((maxX - minX) + padding * 2, padding * 2),
        height: Math.max((maxY - minY) + padding * 2, padding * 2)
    }, 25, 8);

    for (let pointIndex = 0; pointIndex < snapPoints.length; pointIndex += 1) {
        snapPointQuadtree.insert(snapPoints[pointIndex]);
        if (pointIndex > 0 && pointIndex % 5000 === 0 && performance.now() - lastYieldTime > 8) {
            await yieldToBrowser();
            if (buildToken !== snapPointIndexBuildToken) return false;
            lastYieldTime = performance.now();
        }
    }
    const layerLineBounds = new Map();
    const uniqueLineCandidates = Array.from(uniqueLines.values());
    for (let lineIndex = 0; lineIndex < uniqueLineCandidates.length; lineIndex += 1) {
        const lineCandidate = uniqueLineCandidates[lineIndex];
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
        if (lineIndex > 0 && lineIndex % 3000 === 0 && performance.now() - lastYieldTime > 8) {
            await yieldToBrowser();
            if (buildToken !== snapPointIndexBuildToken) return false;
            lastYieldTime = performance.now();
        }
    }

    for (const [layerName, lineBounds] of layerLineBounds.entries()) {
        const layerLineCandidates = snapPointLineItemsByLayer.get(layerName);
        if (!Array.isArray(layerLineCandidates) || !layerLineCandidates.length) continue;

        const layerQuadtree = new Quadtree({
            x: lineBounds.minX - padding,
            y: lineBounds.minY - padding,
            width: Math.max((lineBounds.maxX - lineBounds.minX) + padding * 2, padding * 2),
            height: Math.max((lineBounds.maxY - lineBounds.minY) + padding * 2, padding * 2)
        }, 25, 8);

        for (let lineIndex = 0; lineIndex < layerLineCandidates.length; lineIndex += 1) {
            layerQuadtree.insert(layerLineCandidates[lineIndex]);
            if (lineIndex > 0 && lineIndex % 3000 === 0 && performance.now() - lastYieldTime > 8) {
                await yieldToBrowser();
                if (buildToken !== snapPointIndexBuildToken) return false;
                lastYieldTime = performance.now();
            }
        }
        snapPointLineQuadtreesByLayer.set(layerName, layerQuadtree);
    }
    if (buildToken !== snapPointIndexBuildToken) return false;

    snapPointIndexReady = true;
    updateManualLabelUI();
    return true;
}

function ensureSnapPointIndexAsync() {
    cancelManualSnapPointIndexWarmup();
    if (snapPointIndexReady) {
        return Promise.resolve(true);
    }
    if (snapPointIndexBuildPromise) {
        return snapPointIndexBuildPromise;
    }

    const buildPromise = rebuildSnapPointIndex()
        .catch(error => {
            snapPointIndexReady = false;
            throw error;
        })
        .finally(() => {
            if (snapPointIndexBuildPromise === buildPromise) {
                snapPointIndexBuildPromise = null;
            }
        });

    snapPointIndexBuildPromise = buildPromise;
    return buildPromise;
}

function ensureSnapPointIndex() {
    void ensureSnapPointIndexAsync();
}

function scheduleSnapPointIndexWarmup() {
    if (snapPointIndexReady || snapPointIndexBuildPromise || !hasManualLineCandidateSource()) return;

    cancelManualSnapPointIndexWarmup();

    const startWarmup = () => {
        snapPointIndexWarmupHandle = null;
        snapPointIndexWarmupUsesIdleCallback = false;
        if (snapPointIndexReady || snapPointIndexBuildPromise || !hasManualLineCandidateSource()) return;
        void ensureSnapPointIndexAsync().catch(error => {
            console.warn('Failed to warm up manual snap point index:', error);
        });
    };

    if (typeof requestIdleCallback === 'function') {
        snapPointIndexWarmupUsesIdleCallback = true;
        snapPointIndexWarmupHandle = requestIdleCallback(startWarmup, { timeout: 200 });
        return;
    }

    snapPointIndexWarmupUsesIdleCallback = false;
    snapPointIndexWarmupHandle = setTimeout(startWarmup, 0);
}

function invalidateSnapPointIndex() {
    cancelManualSnapPointIndexWarmup();
    snapPoints = [];
    snapPointQuadtree = null;
    snapPointLineCandidates = new Map();
    snapPointLineItems = new Map();
    snapPointLineItemsByLayer = new Map();
    snapPointLineQuadtreesByLayer = new Map();
    hoveredSnapPoint = null;
    snapPointIndexReady = false;
    snapPointIndexBuildPromise = null;
    snapPointIndexBuildToken += 1;
    suggestedConnectAnnotations = [];
    manualSuggestionRequestId += 1;
    updateManualLabelUI();
}

function cancelManualSnapPointIndexWarmup() {
    if (snapPointIndexWarmupHandle === null) return;

    if (snapPointIndexWarmupUsesIdleCallback && typeof cancelIdleCallback === 'function') {
        cancelIdleCallback(snapPointIndexWarmupHandle);
    } else {
        clearTimeout(snapPointIndexWarmupHandle);
    }
    snapPointIndexWarmupHandle = null;
    snapPointIndexWarmupUsesIdleCallback = false;
}

function cancelSnapPointIndexBuild() {
    cancelManualSnapPointIndexWarmup();
    snapPointIndexBuildToken += 1;
    snapPointIndexBuildPromise = null;
}

function getAnnotationSnapToleranceWorld() {
    return CONFIG.MANUAL_LABEL_SNAP_SCREEN_PX / Math.max(zoom, 0.01);
}

function findNearestSnapPoint(worldX, worldY, options = {}) {
    const worldTolerance = options.worldTolerance || getAnnotationSnapToleranceWorld();
    const queryRange = {
        minX: worldX - worldTolerance,
        minY: worldY - worldTolerance,
        maxX: worldX + worldTolerance,
        maxY: worldY + worldTolerance
    };

    const requiredLayerName = options.layerName || null;
    const allowFallback = options.allowFallback !== false;
    const candidates = snapPointQuadtree
        ? Array.from(new Set(snapPointQuadtree.query(queryRange)))
        : ((!allowFallback || snapPointIndexReady)
            ? []
            : (() => {
            const pointMap = new Map();
            queryLineCandidatesFromSharedShapeCache(requiredLayerName, queryRange).forEach(lineCandidate => {
                lineCandidate.points.slice(0, 2).forEach(point => {
                    const pointKey = getSnapPointKey(lineCandidate.layerName, point.x, point.y);
                    if (!pointMap.has(pointKey)) {
                        pointMap.set(pointKey, {
                            id: pointKey,
                            x: point.x,
                            y: point.y,
                            layerName: lineCandidate.layerName,
                            bbox: { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y }
                        });
                    }
                });
            });
            return Array.from(pointMap.values());
        })());
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
    const candidates = queryManualAnnotationsNearPoint(worldX, worldY);

    candidates.forEach(annotation => {
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

function findNearestConnectAnnotation(worldX, worldY) {
    const worldTolerance = getAnnotationSnapToleranceWorld();
    let nearest = null;
    let bestScore = Infinity;
    const candidates = queryManualAnnotationsNearPoint(worldX, worldY, 'connect');

    candidates.forEach(annotation => {
        if (annotation?.type !== 'connect' || !layerVisibility[annotation.layerName]) return;
        const polygon = getManualAnnotationWorldPolygon(annotation);
        if (!polygon) return;

        const score = distancePointToPolygon(worldX, worldY, polygon);
        if (score <= worldTolerance && score < bestScore) {
            nearest = annotation;
            bestScore = score;
        }
    });

    return nearest;
}

function handleConnectPairCheckSelection(worldX, worldY) {
    const targetAnnotation = findNearestConnectAnnotation(worldX, worldY);
    if (!targetAnnotation) {
        setAnnotationFeedback('Chỉ chọn được connect annotation đã gán nhãn để pair-check.', 'error');
        return true;
    }

    if (!pairCheckSelectionIds.length || pairCheckSelectionIds.length >= 2) {
        pairCheckSelectionIds = [targetAnnotation.id];
        pairCheckLastReport = null;
        hoveredAnnotationId = targetAnnotation.id;
        setAnnotationFeedback(`Đã chọn connect 1: ${getConnectAnnotationDisplayLabel(targetAnnotation)}. Chọn connect còn lại để kiểm tra.`, 'info');
        if (typeof scheduleDraw === 'function') scheduleDraw();
        return true;
    }

    if (pairCheckSelectionIds[0] === targetAnnotation.id) {
        setAnnotationFeedback('Connect thứ 2 phải khác connect thứ 1.', 'error');
        return true;
    }

    pairCheckSelectionIds = [pairCheckSelectionIds[0], targetAnnotation.id];
    hoveredAnnotationId = targetAnnotation.id;
    const [annotationA, annotationB] = getPairCheckSelectionAnnotations();
    pairCheckLastReport = evaluateBidirectionalConnectSuggestionPair(annotationA, annotationB);
    logConnectPairCheckReport(pairCheckLastReport, annotationA, annotationB);
    setAnnotationFeedback(
        buildPairCheckFeedbackMessage(pairCheckLastReport, annotationA, annotationB),
        pairCheckLastReport.hasAnySuggestion ? 'info' : 'error'
    );
    if (typeof scheduleDraw === 'function') scheduleDraw();
    return true;
}

function refreshAnnotationModeLabel() {
    if (typeof updateModeLabel === 'function') {
        updateModeLabel(annotationMode);
    }
}

function shouldPreferSuggestedConnectAnnotation(candidateSuggestion, existingSuggestion) {
    if (!candidateSuggestion) return false;
    if (!existingSuggestion) return true;

    const candidateEffectiveLength = getConnectAnnotationEffectiveLength(candidateSuggestion);
    const existingEffectiveLength = getConnectAnnotationEffectiveLength(existingSuggestion);
    if (Math.abs(candidateEffectiveLength - existingEffectiveLength) > 1e-6) {
        return candidateEffectiveLength > existingEffectiveLength;
    }

    const candidateSegmentLength = getConnectAnnotationLength(candidateSuggestion);
    const existingSegmentLength = getConnectAnnotationLength(existingSuggestion);
    if (Math.abs(candidateSegmentLength - existingSegmentLength) > 1e-6) {
        return candidateSegmentLength > existingSegmentLength;
    }

    return getConnectAnnotationSegments(candidateSuggestion).length > getConnectAnnotationSegments(existingSuggestion).length;
}

function isPointNearSuggestedConnectSegments(point, segments, tolerance = getManualEndpointTouchToleranceWorld()) {
    if (!point || !Array.isArray(segments) || !segments.length) return false;
    return segments.some(segment =>
        Array.isArray(segment)
        && segment.length >= 2
        && distancePointToSegment(
            Number(point.x),
            Number(point.y),
            Number(segment[0].x),
            Number(segment[0].y),
            Number(segment[1].x),
            Number(segment[1].y)
        ) <= tolerance
    );
}

function doesSuggestedConnectCoverSuggestion(parentSuggestion, childSuggestion, tolerance = getManualEndpointTouchToleranceWorld()) {
    if (!parentSuggestion || !childSuggestion || parentSuggestion.type !== 'connect' || childSuggestion.type !== 'connect') return false;
    if (parentSuggestion === childSuggestion || parentSuggestion.id === childSuggestion.id) return false;
    if (parentSuggestion.layerName !== childSuggestion.layerName) return false;

    const parentReferenceLineCandidate = getReferenceLineCandidateForAnnotation(parentSuggestion);
    const childReferenceLineCandidate = getReferenceLineCandidateForAnnotation(childSuggestion);
    if (!parentReferenceLineCandidate || !childReferenceLineCandidate) return false;
    if (!areParallelLineCandidates(parentReferenceLineCandidate, childReferenceLineCandidate)) return false;

    const parentSegmentLength = getConnectAnnotationLength(parentSuggestion);
    const childSegmentLength = getConnectAnnotationLength(childSuggestion);
    const minimumLengthGain = Math.max(tolerance, 1e-4);
    if (!(parentSegmentLength > childSegmentLength + minimumLengthGain)) return false;

    const parentSegments = getConnectAnnotationSegments(parentSuggestion);
    const childSegments = getConnectAnnotationSegments(childSuggestion);
    if (!parentSegments.length || !childSegments.length) return false;

    return childSegments.every(segment => {
        if (!Array.isArray(segment) || segment.length < 2) return false;
        const midpoint = {
            x: (Number(segment[0].x) + Number(segment[1].x)) / 2,
            y: (Number(segment[0].y) + Number(segment[1].y)) / 2,
            layerName: childSuggestion.layerName
        };
        return [segment[0], midpoint, segment[1]].every(point =>
            isPointNearSuggestedConnectSegments(point, parentSegments, tolerance)
        );
    });
}

function getSuggestedConnectCoverageBounds(suggestion, padding = 0) {
    if (!suggestion || suggestion.type !== 'connect') return null;
    return getConnectAnnotationSearchBounds(suggestion, padding);
}

function canSuggestedConnectBoundsCover(parentEntry, childEntry, tolerance) {
    if (!parentEntry?.bounds || !childEntry?.bounds) return true;
    return doBoundsIntersect(expandBounds(parentEntry.bounds, tolerance), childEntry.bounds);
}

function filterCoveredSuggestedConnectAnnotations(suggestions) {
    const suggestionEntries = (suggestions || [])
        .filter(suggestion => suggestion && suggestion.type === 'connect')
        .map((suggestion, index) => ({
            suggestion,
            index,
            layerName: suggestion.layerName,
            bounds: getSuggestedConnectCoverageBounds(suggestion, 0)
        }));
    if (suggestionEntries.length <= 1) {
        return suggestionEntries.map(entry => entry.suggestion);
    }

    const entriesByLayer = new Map();
    suggestionEntries.forEach(entry => {
        const layerEntries = entriesByLayer.get(entry.layerName);
        if (layerEntries) {
            layerEntries.push(entry);
        } else {
            entriesByLayer.set(entry.layerName, [entry]);
        }
    });

    const tolerance = getManualEndpointTouchToleranceWorld();
    return suggestionEntries
        .filter(candidateEntry => {
            const layerEntries = entriesByLayer.get(candidateEntry.layerName) || [];
            return !layerEntries.some(otherEntry => {
                if (candidateEntry.index === otherEntry.index) return false;
                if (!canSuggestedConnectBoundsCover(otherEntry, candidateEntry, tolerance)) return false;
                if (!shouldPreferSuggestedConnectAnnotation(otherEntry.suggestion, candidateEntry.suggestion)) return false;
                return doesSuggestedConnectCoverSuggestion(otherEntry.suggestion, candidateEntry.suggestion, tolerance);
            });
        })
        .map(entry => entry.suggestion);
}

function mergeUniqueSuggestedConnectAnnotations(suggestions) {
    const suggestionsByKey = new Map();

    (suggestions || []).forEach(suggestion => {
        if (!suggestion || suggestion.type !== 'connect') return;
        const suggestionKey = getConnectAnnotationGroupKey(suggestion)
            || getConnectAnnotationTraversalKey(suggestion)
            || suggestion.id;
        if (!suggestionKey) return;

        const existingSuggestion = suggestionsByKey.get(suggestionKey);
        if (shouldPreferSuggestedConnectAnnotation(suggestion, existingSuggestion)) {
            suggestionsByKey.set(suggestionKey, suggestion);
        }
    });

    return filterCoveredSuggestedConnectAnnotations(Array.from(suggestionsByKey.values()));
}

function collectSuggestedConnectAnnotationsForConnects(connectAnnotations) {
    if (!Array.isArray(connectAnnotations) || !connectAnnotations.length || !hasManualLineCandidateSource()) {
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

    const seedSuggestions = buildConnectSuggestionsFromSeedLines(
        Array.from(mergedSeedLineCandidates.values()),
        existingConnectLineKeys
    );
    const overlaySuggestions = typeof buildExpandedStraightConnectSuggestionsFromAnnotations === 'function'
        ? buildExpandedStraightConnectSuggestionsFromAnnotations(connectAnnotations, existingConnectLineKeys)
        : [];
    return mergeUniqueSuggestedConnectAnnotations([...seedSuggestions, ...overlaySuggestions]);
}

async function collectSuggestedConnectAnnotationsForConnectsAsync(connectAnnotations, options = {}) {
    if (!Array.isArray(connectAnnotations) || !connectAnnotations.length || !hasManualLineCandidateSource()) {
        return [];
    }

    const metrics = options.metrics && typeof options.metrics === 'object'
        ? options.metrics
        : null;
    const collectStartTime = performance.now();

    const existingConnectLineKeysStartTime = performance.now();
    const existingConnectLineKeys = collectExistingConnectLineKeys([
        ...manualAnnotations,
        ...connectAnnotations
    ]);
    if (metrics) {
        metrics.existingConnectLineKeysMs = performance.now() - existingConnectLineKeysStartTime;
        metrics.existingConnectLineKeyCount = existingConnectLineKeys.size;
    }
    const mergedSeedLineCandidates = new Map();

    const straightSeedsStartTime = performance.now();
    const straightSeeds = typeof collectStraightConnectSuggestionSeedsAsync === 'function'
        ? await collectStraightConnectSuggestionSeedsAsync(connectAnnotations, existingConnectLineKeys, options)
        : collectStraightConnectSuggestionSeeds(connectAnnotations, existingConnectLineKeys);
    if (!shouldContinueManualSuggestionWork(options)) return [];
    if (metrics) {
        metrics.straightSeedMs = performance.now() - straightSeedsStartTime;
        metrics.straightSeedCount = straightSeeds.length;
    }
    straightSeeds.forEach(lineCandidate => {
        if (!lineCandidate) return;
        mergedSeedLineCandidates.set(lineCandidate.id, lineCandidate);
    });

    if (typeof yieldToBrowser === 'function') {
        await yieldToBrowser();
    }
    if (!shouldContinueManualSuggestionWork(options)) return [];

    const teeSeedsStartTime = performance.now();
    const teeSeeds = typeof collectTeeConnectSuggestionSeedsAsync === 'function'
        ? await collectTeeConnectSuggestionSeedsAsync(connectAnnotations, existingConnectLineKeys, options)
        : collectTeeConnectSuggestionSeeds(connectAnnotations, existingConnectLineKeys);
    if (!shouldContinueManualSuggestionWork(options)) return [];
    if (metrics) {
        metrics.teeSeedMs = performance.now() - teeSeedsStartTime;
        metrics.teeSeedCount = teeSeeds.length;
    }
    teeSeeds.forEach(lineCandidate => {
        if (!lineCandidate) return;
        mergedSeedLineCandidates.set(lineCandidate.id, lineCandidate);
    });

    const seedLineCandidates = Array.from(mergedSeedLineCandidates.values());
    if (metrics) {
        metrics.seedLineCandidateCount = seedLineCandidates.length;
    }
    const seedSuggestionsStartTime = performance.now();
    const seedSuggestions = typeof buildConnectSuggestionsFromSeedLinesAsync === 'function'
        ? buildConnectSuggestionsFromSeedLinesAsync(seedLineCandidates, existingConnectLineKeys, options)
        : buildConnectSuggestionsFromSeedLines(seedLineCandidates, existingConnectLineKeys);
    const resolvedSeedSuggestions = await Promise.resolve(seedSuggestions);
    if (!shouldContinueManualSuggestionWork(options)) return [];
    if (metrics) {
        metrics.buildSeedSuggestionsMs = performance.now() - seedSuggestionsStartTime;
        metrics.seedSuggestionCount = resolvedSeedSuggestions.length;
    }

    const overlaySuggestionsStartTime = performance.now();
    const overlaySuggestions = typeof buildExpandedStraightConnectSuggestionsFromAnnotations === 'function'
        ? buildExpandedStraightConnectSuggestionsFromAnnotations(connectAnnotations, existingConnectLineKeys)
        : [];
    if (metrics) {
        metrics.overlaySuggestionsMs = performance.now() - overlaySuggestionsStartTime;
        metrics.overlaySuggestionCount = overlaySuggestions.length;
    }

    const mergeSuggestionsStartTime = performance.now();
    const mergedSuggestions = mergeUniqueSuggestedConnectAnnotations([...resolvedSeedSuggestions, ...overlaySuggestions]);
    if (metrics) {
        metrics.mergeSuggestionsMs = performance.now() - mergeSuggestionsStartTime;
        metrics.mergedSuggestionCount = mergedSuggestions.length;
        metrics.collectSuggestionsMs = performance.now() - collectStartTime;
    }

    return mergedSuggestions;
}

function formatConnectSuggestionSuffix(suggestedConnectCount) {
    return suggestedConnectCount
        ? ` Đề xuất ${suggestedConnectCount} connect lân cận, nhấn Tab để thêm nhanh.`
        : '';
}

function startSuggestedConnectAnnotationsRequest(requestId, connectAnnotations, baseMessage, options = {}) {
    const shouldKeepRequest = () => requestId === manualSuggestionRequestId
        && (options.requireConnectMode === false || annotationMode === 'connect');
    const suppressUi = options.suppressUi === true;
    if (!shouldKeepRequest()) return Promise.resolve([]);

    if (!suppressUi) {
        setAnnotationFeedback(`${baseMessage} Đang tìm gợi ý...`, 'info');
        updateManualLabelUI();
        if (typeof scheduleDraw === 'function') scheduleDraw();
    }

    return collectSuggestedConnectAnnotationsForConnectsAsync(connectAnnotations, {
        ...options,
        shouldContinue: shouldKeepRequest
    })
        .then(suggestedConnects => {
            if (!shouldKeepRequest()) return [];
            if (!suppressUi) {
                setSuggestedConnectAnnotations(suggestedConnects, { redraw: false });
                setAnnotationFeedback(`${baseMessage}${formatConnectSuggestionSuffix(suggestedConnects.length)}`, 'info');
                updateManualLabelUI();
                if (typeof scheduleDraw === 'function') scheduleDraw();
            }
            return suggestedConnects;
        })
        .catch(error => {
            if (!shouldKeepRequest()) return [];
            console.error('Failed to collect manual connect suggestions:', error);
            if (!suppressUi) {
                setAnnotationFeedback(`${baseMessage} Không tính được gợi ý connect: ${error.message}`, 'error');
                updateManualLabelUI();
            }
            return [];
        });
}

function requestSuggestedConnectAnnotations(connectAnnotations, baseMessage, options = {}) {
    const requestId = ++manualSuggestionRequestId;
    const suppressUi = options.suppressUi === true;
    const metrics = options.metrics && typeof options.metrics === 'object'
        ? options.metrics
        : null;
    const requestStartTime = performance.now();
    const finalizeRequestMetrics = suggestedConnects => {
        if (metrics) {
            metrics.requestTotalMs = performance.now() - requestStartTime;
            metrics.suggestedCount = Array.isArray(suggestedConnects) ? suggestedConnects.length : 0;
        }
        return suggestedConnects;
    };
    if (typeof options.onRequestId === 'function') {
        options.onRequestId(requestId);
    }
    const rootExpansionStartTime = performance.now();
    const suggestionRootAnnotations = collectConnectedSuggestionRootAnnotations(connectAnnotations, manualAnnotations);
    if (metrics) {
        metrics.inputSeedCount = Array.isArray(connectAnnotations) ? connectAnnotations.length : 0;
        metrics.rootSeedCount = suggestionRootAnnotations.length;
        metrics.rootExpansionMs = performance.now() - rootExpansionStartTime;
        metrics.snapIndexReadyAtStart = Boolean(snapPointIndexReady);
    }
    suggestedConnectAnnotations = [];
    if (!suppressUi) {
        updateManualLabelUI();
        if (typeof scheduleDraw === 'function') scheduleDraw();
    }

    if (!snapPointIndexReady) {
        if (!suppressUi) {
            setAnnotationFeedback(`${baseMessage} Đang chuẩn bị chỉ mục line để gợi ý...`, 'info');
            updateManualLabelUI();
            if (typeof scheduleDraw === 'function') scheduleDraw();
        }
        scheduleSnapPointIndexWarmup();
        const indexWaitStartTime = performance.now();
        return ensureSnapPointIndexAsync()
            .then(indexReady => {
                if (metrics) {
                    metrics.indexWaitMs = performance.now() - indexWaitStartTime;
                }
                if (!indexReady) return [];
                return startSuggestedConnectAnnotationsRequest(requestId, suggestionRootAnnotations, baseMessage, options);
            })
            .catch(error => {
                if (requestId !== manualSuggestionRequestId) return [];
                console.error('Failed to prepare manual snap point index:', error);
                if (!suppressUi) {
                    setAnnotationFeedback(`${baseMessage} Không chuẩn bị được chỉ mục gợi ý: ${error.message}`, 'error');
                    updateManualLabelUI();
                }
                return [];
            })
            .then(finalizeRequestMetrics);
    }

    if (metrics) {
        metrics.indexWaitMs = 0;
    }
    return startSuggestedConnectAnnotationsRequest(requestId, suggestionRootAnnotations, baseMessage, options)
        .then(finalizeRequestMetrics);
}

function acceptSuggestedConnectAnnotations(options = {}) {
    const requestNextSuggestions = options.requestNextSuggestions !== false;
    const silent = options.silent === true;
    const suppressUi = options.suppressUi === true;
    const providedSuggestions = Array.isArray(options.suggestions) ? options.suggestions : null;
    const sourceSuggestions = providedSuggestions || suggestedConnectAnnotations;
    if (!Array.isArray(sourceSuggestions) || !sourceSuggestions.length) {
        return options.returnResult ? {
            accepted: false,
            finalizationResult: null,
            addedConnectAnnotations: [],
            addedJunctionAnnotations: []
        } : false;
    }

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

    sourceSuggestions.forEach(suggestion => {
        if (!isSuggestConnectLineLikeLongEnough(suggestion)) return;
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
        if (!providedSuggestions) {
            clearSuggestedConnectAnnotations({ redraw: false });
        }
        if (!options.preserveRequestId) {
            manualSuggestionRequestId += 1;
        }
        if (!silent) {
            setAnnotationFeedback('Không có connect gợi ý mới để thêm.', 'info');
        }
        return options.returnResult ? {
            accepted: false,
            finalizationResult: null,
            addedConnectAnnotations: [],
            addedJunctionAnnotations: []
        } : true;
    }

    const existingAnnotationIds = new Set(manualAnnotations.map(annotation => annotation.id));
    const addedAnnotations = addAnnotations([...acceptedConnects, ...acceptedJunctions], {
        record: false,
        updateUi: !suppressUi
    });
    const finalizationResult = finalizeAddedAnnotations(addedAnnotations, {
        existingAnnotationIds,
        record: true,
        updateUi: !suppressUi
    });
    const baseMessage = `Đã thêm ${finalizationResult.addedConnectAnnotations.length} connect và ${finalizationResult.finalAddedAnnotations.filter(annotation => annotation.type === 'junction').length} junction từ gợi ý.`;
    if (!providedSuggestions) {
        setSuggestedConnectAnnotations([], { redraw: false });
    }
    if (requestNextSuggestions && finalizationResult.addedConnectAnnotations.length) {
        requestSuggestedConnectAnnotations(finalizationResult.addedConnectAnnotations, baseMessage);
    } else {
        if (requestNextSuggestions) {
            manualSuggestionRequestId += 1;
        }
        if (!silent) {
            setAnnotationFeedback(baseMessage, 'info');
        }
    }
    refreshAnnotationModeLabel();
    if (!suppressUi && typeof scheduleDraw === 'function') scheduleDraw();
    return options.returnResult ? {
        accepted: finalizationResult.addedConnectAnnotations.length > 0,
        finalizationResult,
        addedConnectAnnotations: finalizationResult.addedConnectAnnotations,
        addedJunctionAnnotations: finalizationResult.finalAddedAnnotations.filter(annotation => annotation.type === 'junction')
    } : true;
}

function normalizeDetectedConnectSpec(connectSpec) {
    if (!connectSpec || typeof connectSpec !== 'object') return null;
    const layerName = typeof connectSpec.layerName === 'string'
        ? connectSpec.layerName
        : (typeof connectSpec.layer_name === 'string' ? connectSpec.layer_name : null);
    const points = Array.isArray(connectSpec.points)
        ? connectSpec.points
        : (Array.isArray(connectSpec.manual_points) ? connectSpec.manual_points : []);
    if (!layerName || points.length < 2) return null;

    const normalizedPoints = points.slice(0, 2).map(point => ({
        x: Number(point?.x ?? point?.[0]),
        y: Number(point?.y ?? point?.[1]),
        layerName
    }));
    if (normalizedPoints.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;

    const lineKeys = Array.isArray(connectSpec.lineKeys)
        ? connectSpec.lineKeys
        : (Array.isArray(connectSpec.line_keys) ? connectSpec.line_keys : []);
    const normalizedLineKeys = lineKeys.map(lineKey => String(lineKey)).filter(Boolean);
    const segments = Array.isArray(connectSpec.segments)
        ? connectSpec.segments
        : (Array.isArray(connectSpec.manual_segments) ? connectSpec.manual_segments : []);
    const normalizedSegments = segments
        .filter(segment => Array.isArray(segment) && segment.length >= 2)
        .map(segment => segment.slice(0, 2).map(point => ({
            x: Number(point?.x ?? point?.[0]),
            y: Number(point?.y ?? point?.[1]),
            layerName
        })))
        .filter(segment => segment.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));

    const resolvedLineCandidates = [];
    if (typeof snapPointLineItems !== 'undefined' && snapPointLineItems instanceof Map && normalizedLineKeys.length) {
        normalizedLineKeys.forEach(lineKey => {
            const lineCandidate = snapPointLineItems.get(lineKey);
            if (!lineCandidate || resolvedLineCandidates.some(candidate => candidate.id === lineCandidate.id)) return;
            resolvedLineCandidates.push(lineCandidate);
        });
    }
    if (!resolvedLineCandidates.length && normalizedSegments.length) {
        normalizedSegments.forEach((segment, segmentIndex) => {
            const pointA = segment[0];
            const pointB = segment[1];
            resolvedLineCandidates.push({
                id: createNormalizedLineKey(layerName, pointA, pointB) || `detection-segment:${segmentIndex}`,
                layerName,
                points: [pointA, pointB],
                endpointKeys: [
                    getSnapPointKey(layerName, pointA.x, pointA.y),
                    getSnapPointKey(layerName, pointB.x, pointB.y)
                ]
            });
        });
    }

    return {
        layerName,
        points: normalizedPoints,
        lineKeys: normalizedLineKeys,
        segments: normalizedSegments,
        lineCandidates: resolvedLineCandidates
    };
}

function buildConnectAutoAcceptManualContext() {
    const connectsById = new Map();
    const connectsByTraversalKey = new Map();
    const lineKeyToConnectEntries = new Map();

    manualAnnotations.forEach(annotation => {
        if (annotation?.type !== 'connect') return;
        if (annotation.id !== undefined && annotation.id !== null) {
            connectsById.set(annotation.id, annotation);
        }
        const traversalKey = getConnectAnnotationTraversalKey(annotation);
        if (traversalKey) {
            const layerTraversalKey = `${annotation.layerName}::${traversalKey}`;
            if (!connectsByTraversalKey.has(layerTraversalKey)) {
                connectsByTraversalKey.set(layerTraversalKey, annotation);
            }
        }
        const lineKeys = getConnectAnnotationLineKeys(annotation);
        const lineKeySet = new Set(lineKeys);
        const connectEntry = { annotation, lineKeySet };
        lineKeys.forEach(lineKey => {
            const entries = lineKeyToConnectEntries.get(lineKey);
            if (entries) {
                entries.push(connectEntry);
            } else {
                lineKeyToConnectEntries.set(lineKey, [connectEntry]);
            }
        });
    });

    return {
        connectsById,
        connectsByTraversalKey,
        lineKeyToConnectEntries
    };
}

function getManualConnectAnnotationForSeed(seedAnnotation, manualContext = null) {
    if (!seedAnnotation || seedAnnotation.type !== 'connect') return null;
    if (seedAnnotation.id !== undefined && seedAnnotation.id !== null) {
        const matchingAnnotation = manualContext?.connectsById instanceof Map
            ? manualContext.connectsById.get(seedAnnotation.id)
            : manualAnnotations.find(annotation => annotation?.type === 'connect' && annotation.id === seedAnnotation.id);
        if (matchingAnnotation) return matchingAnnotation;
    }

    const seedTraversalKey = getConnectAnnotationTraversalKey(seedAnnotation);
    if (!seedTraversalKey) return null;
    const layerTraversalKey = `${seedAnnotation.layerName}::${seedTraversalKey}`;
    if (manualContext?.connectsByTraversalKey instanceof Map) {
        return manualContext.connectsByTraversalKey.get(layerTraversalKey) || null;
    }
    return manualAnnotations.find(annotation =>
        annotation?.type === 'connect'
        && annotation.layerName === seedAnnotation.layerName
        && getConnectAnnotationTraversalKey(annotation) === seedTraversalKey
    ) || null;
}

function isConnectAnnotationCoveredByAnotherManualConnect(annotation, manualContext = null) {
    if (!annotation || annotation.type !== 'connect') return false;
    const annotationLineKeys = getConnectAnnotationLineKeys(annotation);
    if (annotationLineKeys.length && manualContext?.lineKeyToConnectEntries instanceof Map) {
        const candidateEntries = manualContext.lineKeyToConnectEntries.get(annotationLineKeys[0]) || [];
        return candidateEntries.some(entry => {
            const existingAnnotation = entry?.annotation;
            if (!existingAnnotation || existingAnnotation.id === annotation.id || existingAnnotation.layerName !== annotation.layerName) return false;
            return annotationLineKeys.every(lineKey => entry.lineKeySet.has(lineKey));
        });
    }
    return manualAnnotations.some(existingAnnotation => {
        if (!existingAnnotation || existingAnnotation.type !== 'connect') return false;
        if (existingAnnotation.id === annotation.id || existingAnnotation.layerName !== annotation.layerName) return false;

        const existingLineKeys = getConnectAnnotationLineKeys(existingAnnotation);
        if (annotationLineKeys.length && existingLineKeys.length) {
            const existingLineKeySet = new Set(existingLineKeys);
            if (annotationLineKeys.every(lineKey => existingLineKeySet.has(lineKey))) {
                return true;
            }
        }

        return doesConnectAnnotationGeometricallyCover(existingAnnotation, annotation);
    });
}

function getConnectAutoAcceptQueueKey(annotation, fallbackIndex = 0) {
    return getConnectAnnotationTraversalKey(annotation)
        || (annotation?.id !== undefined && annotation.id !== null ? `id:${annotation.id}` : `index:${fallbackIndex}`);
}

function shouldProcessConnectAutoAcceptSeed(seedAnnotation, processedSeedKeys, manualContext = null) {
    const currentAnnotation = getManualConnectAnnotationForSeed(seedAnnotation, manualContext);
    if (!currentAnnotation) return null;
    const seedKey = getConnectAutoAcceptQueueKey(currentAnnotation);
    if (!seedKey || processedSeedKeys.has(seedKey)) return null;
    if (isConnectAnnotationCoveredByAnotherManualConnect(currentAnnotation, manualContext)) return null;
    return { annotation: currentAnnotation, seedKey };
}

function createConnectAutoAcceptSeedQueue(seedConnectAnnotations) {
    const solidSeeds = [];
    const dashedSeeds = [];
    const queuedSolidSeedKeys = new Set();
    const queuedDashedSeedKeys = new Set();
    let solidSeedIndex = 0;
    let dashedSeedIndex = 0;

    const enqueue = (annotation, fallbackIndex = 0) => {
        if (!annotation || annotation.type !== 'connect') return false;
        const seedKey = getConnectAutoAcceptQueueKey(annotation, fallbackIndex);
        if (!seedKey) return false;
        const isDashedSeed = typeof isDashedLineLikeForTeeSuggestion === 'function'
            && isDashedLineLikeForTeeSuggestion(annotation);

        if (isDashedSeed) {
            if (queuedSolidSeedKeys.has(seedKey) || queuedDashedSeedKeys.has(seedKey)) return false;
            queuedDashedSeedKeys.add(seedKey);
            dashedSeeds.push(annotation);
            return true;
        }

        if (queuedSolidSeedKeys.has(seedKey)) return false;
        queuedSolidSeedKeys.add(seedKey);
        solidSeeds.push(annotation);
        return true;
    };

    (seedConnectAnnotations || []).forEach((annotation, index) => {
        enqueue(annotation, index);
    });

    return {
        enqueue,
        get length() {
            return (solidSeeds.length - solidSeedIndex) + (dashedSeeds.length - dashedSeedIndex);
        },
        nextBatch() {
            if (solidSeedIndex < solidSeeds.length) {
                const annotations = solidSeeds.slice(solidSeedIndex);
                solidSeedIndex = solidSeeds.length;
                return { annotations, queueType: 'solid' };
            }
            if (dashedSeedIndex < dashedSeeds.length) {
                const annotations = dashedSeeds.slice(dashedSeedIndex);
                dashedSeedIndex = dashedSeeds.length;
                return { annotations, queueType: 'dashed' };
            }
            return null;
        },
        next() {
            if (solidSeedIndex < solidSeeds.length) {
                const annotation = solidSeeds[solidSeedIndex];
                solidSeedIndex += 1;
                return { annotation, queueType: 'solid' };
            }
            if (dashedSeedIndex < dashedSeeds.length) {
                const annotation = dashedSeeds[dashedSeedIndex];
                dashedSeedIndex += 1;
                return { annotation, queueType: 'dashed' };
            }
            return null;
        }
    };
}

async function autoAcceptSuggestedConnectAnnotationsFromSeedQueue(seedConnectAnnotations, baseMessage, options = {}) {
    const autoAcceptStartTime = performance.now();
    if (!Array.isArray(seedConnectAnnotations) || !seedConnectAnnotations.length || !hasManualLineCandidateSource()) {
        return {
            rounds: 0,
            acceptedConnectCount: 0,
            acceptedJunctionCount: 0,
            timing: {
                totalMs: performance.now() - autoAcceptStartTime,
                roundBreakdown: []
            }
        };
    }

    const seedQueue = createConnectAutoAcceptSeedQueue(seedConnectAnnotations);
    const processedSeedKeys = new Set();
    const roundBreakdown = [];
    let acceptedConnectCount = 0;
    let acceptedJunctionCount = 0;
    let processedSeedCount = 0;
    let processedBatchCount = 0;
    let skippedSeedCount = 0;
    let activeRequestId = null;
    let ownsCurrentRequest = false;

    while (seedQueue.length) {
        const queuedBatch = seedQueue.nextBatch();
        if (!queuedBatch?.annotations?.length) break;

        const manualContext = buildConnectAutoAcceptManualContext();
        const processableSeeds = [];
        let firstProcessableSeedKey = null;
        queuedBatch.annotations.forEach(seedAnnotation => {
            const processableSeed = shouldProcessConnectAutoAcceptSeed(seedAnnotation, processedSeedKeys, manualContext);
            if (!processableSeed) {
                skippedSeedCount += 1;
                return;
            }
            processedSeedKeys.add(processableSeed.seedKey);
            processableSeeds.push(processableSeed.annotation);
            if (firstProcessableSeedKey === null) {
                firstProcessableSeedKey = processableSeed.seedKey;
            }
        });

        if (!processableSeeds.length) {
            continue;
        }

        processedBatchCount += 1;
        processedSeedCount += processableSeeds.length;
        const roundMetrics = {
            round: processedBatchCount,
            queueType: queuedBatch.queueType,
            rawSeedCount: queuedBatch.annotations.length,
            seedCount: processableSeeds.length,
            firstSeedKey: firstProcessableSeedKey,
            fullRecheckExistingConnects: false,
            recheckSeedSource: 'frontier-queue'
        };
        const requestMetrics = {};
        const requestStartTime = performance.now();
        const suggestedConnects = await requestSuggestedConnectAnnotations(processableSeeds, baseMessage, {
            requireConnectMode: false,
            suppressUi: options.suppressUi === true,
            onRequestId: requestId => {
                activeRequestId = requestId;
                ownsCurrentRequest = true;
            },
            metrics: requestMetrics
        });
        roundMetrics.requestMs = performance.now() - requestStartTime;
        roundMetrics.suggestedCount = suggestedConnects.length;
        roundMetrics.request = requestMetrics;

        if (activeRequestId !== manualSuggestionRequestId) {
            roundMetrics.acceptMs = 0;
            roundMetrics.acceptedConnectCount = 0;
            roundMetrics.acceptedJunctionCount = 0;
            roundMetrics.totalMs = roundMetrics.requestMs;
            roundMetrics.exitReason = 'stale-request';
            roundBreakdown.push(roundMetrics);
            break;
        }

        if (!suggestedConnects.length) {
            roundMetrics.acceptMs = 0;
            roundMetrics.acceptedConnectCount = 0;
            roundMetrics.acceptedJunctionCount = 0;
            roundMetrics.totalMs = roundMetrics.requestMs;
            roundMetrics.exitReason = 'no-suggestions';
            roundBreakdown.push(roundMetrics);
            continue;
        }

        const acceptStartTime = performance.now();
        const acceptResult = acceptSuggestedConnectAnnotations({
            suggestions: suggestedConnects,
            requestNextSuggestions: false,
            returnResult: true,
            silent: true,
            suppressUi: options.suppressUi === true,
            preserveRequestId: true
        });
        roundMetrics.acceptMs = performance.now() - acceptStartTime;
        roundMetrics.acceptedConnectCount = acceptResult?.addedConnectAnnotations?.length || 0;
        roundMetrics.acceptedJunctionCount = acceptResult?.addedJunctionAnnotations?.length || 0;
        roundMetrics.totalMs = roundMetrics.requestMs + roundMetrics.acceptMs;

        if (!acceptResult?.accepted || !acceptResult.addedConnectAnnotations.length) {
            roundMetrics.exitReason = 'no-new-accepted-connects';
            roundBreakdown.push(roundMetrics);
            continue;
        }

        acceptResult.addedConnectAnnotations.forEach((annotation, index) => {
            seedQueue.enqueue(annotation, `${processedBatchCount}:${index}`);
        });
        acceptedConnectCount += acceptResult.addedConnectAnnotations.length;
        acceptedJunctionCount += acceptResult.addedJunctionAnnotations.length;
        roundMetrics.exitReason = 'accepted';
        roundMetrics.queueLengthAfterAccept = seedQueue.length;
        roundBreakdown.push(roundMetrics);

        if (typeof yieldToBrowser === 'function') {
            await yieldToBrowser();
        }
    }

    if (ownsCurrentRequest && activeRequestId === manualSuggestionRequestId) {
        suggestedConnectAnnotations = [];
        manualSuggestionRequestId += 1;
    }

    const suffix = acceptedConnectCount
        ? ` Tự thêm ${acceptedConnectCount} connect và ${acceptedJunctionCount} junction từ gợi ý.`
        : ' Không có gợi ý connect mới để tự thêm.';
    setAnnotationFeedback(`${baseMessage}${suffix}`, 'info');
    updateManualLabelUI();
    if (typeof scheduleDraw === 'function') scheduleDraw();

    return {
        rounds: processedSeedCount,
        acceptedConnectCount,
        acceptedJunctionCount,
        timing: {
            totalMs: performance.now() - autoAcceptStartTime,
            roundBreakdown,
            skippedSeedCount
        }
    };
}

async function autoAcceptSuggestedConnectAnnotationsFromSeeds(seedConnectAnnotations, baseMessage, options = {}) {
    const autoAcceptStartTime = performance.now();
    if (!Array.isArray(seedConnectAnnotations) || !seedConnectAnnotations.length || !hasManualLineCandidateSource()) {
        return {
            rounds: 0,
            acceptedConnectCount: 0,
            acceptedJunctionCount: 0,
            timing: {
                totalMs: performance.now() - autoAcceptStartTime,
                roundBreakdown: []
            }
        };
    }
    if (options.seedQueueAutoAccept === true) {
        return autoAcceptSuggestedConnectAnnotationsFromSeedQueue(seedConnectAnnotations, baseMessage, options);
    }

    const maxRounds = Math.max(0, Number(options.maxRounds) || 0);
    if (!maxRounds) {
        requestSuggestedConnectAnnotations(seedConnectAnnotations, baseMessage);
        return {
            rounds: 0,
            acceptedConnectCount: 0,
            acceptedJunctionCount: 0,
            timing: {
                totalMs: performance.now() - autoAcceptStartTime,
                roundBreakdown: []
            }
        };
    }

    let acceptedConnectCount = 0;
    let acceptedJunctionCount = 0;
    let completedRounds = 0;
    let activeRequestId = null;
    let ownsCurrentRequest = false;
    const roundBreakdown = [];
    let previousRoundAcceptedConnectAnnotations = [];

    const getRepresentativeRoundSeeds = connectAnnotations => {
        if (typeof collectRepresentativeSuggestionTraversalSeedAnnotations !== 'function') {
            return Array.isArray(connectAnnotations) ? connectAnnotations : [];
        }
        return collectRepresentativeSuggestionTraversalSeedAnnotations(connectAnnotations, manualAnnotations);
    };

    const shouldUseTouchedComponentRecheck = roundIndex => roundIndex > 0
        && options.fullRecheckExistingConnects !== false
        && options.recheckFromAcceptedSuggestions !== false
        && previousRoundAcceptedConnectAnnotations.length > 0;

    const getRawRoundSeeds = roundIndex => {
        if (roundIndex <= 0 || options.fullRecheckExistingConnects === false) {
            return seedConnectAnnotations;
        }
        if (shouldUseTouchedComponentRecheck(roundIndex)) {
            return previousRoundAcceptedConnectAnnotations;
        }
        return manualAnnotations.filter(annotation => annotation?.type === 'connect');
    };

    const getRoundSeeds = roundIndex => {
        return getRepresentativeRoundSeeds(getRawRoundSeeds(roundIndex));
    };

    for (let roundIndex = 0; roundIndex < maxRounds; roundIndex += 1) {
        const rawRoundSeeds = getRawRoundSeeds(roundIndex);
        const currentSeeds = getRoundSeeds(roundIndex);
        if (!currentSeeds.length) break;
        const roundMetrics = {
            round: roundIndex + 1,
            rawSeedCount: rawRoundSeeds.length,
            seedCount: currentSeeds.length,
            fullRecheckExistingConnects: roundIndex > 0 && options.fullRecheckExistingConnects !== false,
            recheckSeedSource: roundIndex <= 0 || options.fullRecheckExistingConnects === false
                ? 'initial'
                : (shouldUseTouchedComponentRecheck(roundIndex) ? 'previous-accepted' : 'all-manual-connects')
        };
        const roundMessage = maxRounds > 1
            ? `${baseMessage} Đang tự mở rộng connect (${roundIndex + 1}/${maxRounds})...`
            : baseMessage;
        const requestMetrics = {};
        const requestStartTime = performance.now();
        const suggestedConnects = await requestSuggestedConnectAnnotations(currentSeeds, roundMessage, {
            requireConnectMode: false,
            suppressUi: options.suppressUi === true,
            onRequestId: requestId => {
                activeRequestId = requestId;
                ownsCurrentRequest = true;
            },
            metrics: requestMetrics
        });
        roundMetrics.requestMs = performance.now() - requestStartTime;
        roundMetrics.suggestedCount = suggestedConnects.length;
        roundMetrics.request = requestMetrics;
        if (activeRequestId !== manualSuggestionRequestId || !suggestedConnects.length) {
            roundMetrics.acceptMs = 0;
            roundMetrics.acceptedConnectCount = 0;
            roundMetrics.acceptedJunctionCount = 0;
            roundMetrics.totalMs = roundMetrics.requestMs;
            roundMetrics.exitReason = activeRequestId !== manualSuggestionRequestId
                ? 'stale-request'
                : 'no-suggestions';
            roundBreakdown.push(roundMetrics);
            break;
        }

        const shouldRequestNextSuggestions = roundIndex === maxRounds - 1 && options.requestNextSuggestions !== false;
        const acceptStartTime = performance.now();
        const acceptResult = acceptSuggestedConnectAnnotations({
            suggestions: options.suppressUi === true ? suggestedConnects : undefined,
            requestNextSuggestions: shouldRequestNextSuggestions,
            returnResult: true,
            silent: true,
            suppressUi: options.suppressUi === true,
            preserveRequestId: !shouldRequestNextSuggestions
        });
        roundMetrics.acceptMs = performance.now() - acceptStartTime;
        if (shouldRequestNextSuggestions) {
            ownsCurrentRequest = false;
        }
        roundMetrics.acceptedConnectCount = acceptResult?.addedConnectAnnotations?.length || 0;
        roundMetrics.acceptedJunctionCount = acceptResult?.addedJunctionAnnotations?.length || 0;
        roundMetrics.totalMs = roundMetrics.requestMs + roundMetrics.acceptMs;
        if (!acceptResult?.accepted || !acceptResult.addedConnectAnnotations.length) {
            roundMetrics.exitReason = 'no-new-accepted-connects';
            roundBreakdown.push(roundMetrics);
            break;
        }

        roundMetrics.exitReason = 'accepted';
        roundBreakdown.push(roundMetrics);

        completedRounds += 1;
        acceptedConnectCount += acceptResult.addedConnectAnnotations.length;
        acceptedJunctionCount += acceptResult.addedJunctionAnnotations.length;
        previousRoundAcceptedConnectAnnotations = acceptResult.addedConnectAnnotations;

        if (typeof yieldToBrowser === 'function') {
            await yieldToBrowser();
        }
    }

    if (ownsCurrentRequest && activeRequestId === manualSuggestionRequestId) {
        setSuggestedConnectAnnotations([], { redraw: false });
        manualSuggestionRequestId += 1;
        const suffix = acceptedConnectCount
            ? ` Tự thêm ${acceptedConnectCount} connect và ${acceptedJunctionCount} junction từ gợi ý.`
            : ' Không có gợi ý connect mới để tự thêm.';
        setAnnotationFeedback(`${baseMessage}${suffix}`, 'info');
        updateManualLabelUI();
        if (typeof scheduleDraw === 'function') scheduleDraw();
    }

    return {
        rounds: completedRounds,
        acceptedConnectCount,
        acceptedJunctionCount,
        timing: {
            totalMs: performance.now() - autoAcceptStartTime,
            roundBreakdown
        }
    };
}

async function addDetectedConnectAnnotationsToManualPanel(connectSpecs, options = {}) {
    const promotionStartTime = performance.now();
    const normalizedSpecs = (Array.isArray(connectSpecs) ? connectSpecs : [])
        .map(normalizeDetectedConnectSpec)
        .filter(Boolean);
    if (!normalizedSpecs.length) {
        return {
            addedConnectCount: 0,
            addedJunctionCount: 0,
            suggestionAcceptedConnectCount: 0,
            suggestionAcceptedJunctionCount: 0,
            timing: {
                totalMs: performance.now() - promotionStartTime,
                addToManualMs: 0,
                autoAcceptMs: 0,
                autoAccept: {
                    totalMs: 0,
                    roundBreakdown: []
                }
            }
        };
    }

    const connectAnnotations = normalizedSpecs
        .map(spec => {
            const annotationOptions = {
                source: options.source || 'detection',
                autoManaged: false
            };
            if (Array.isArray(spec.lineCandidates) && spec.lineCandidates.length && typeof createConnectAnnotationFromLineCandidates === 'function') {
                return createConnectAnnotationFromLineCandidates(spec.lineCandidates, annotationOptions);
            }
            return createAnnotation('connect', spec.layerName, spec.points, {
                ...annotationOptions,
                lineKeys: spec.lineKeys,
                segments: spec.segments
            });
        })
        .filter(Boolean);
    const autoJunctions = [];
    connectAnnotations.forEach(connectAnnotation => {
        createAutoJunctionsForConnect(connectAnnotation.layerName, connectAnnotation.points, connectAnnotation)
            .forEach(junctionAnnotation => autoJunctions.push(junctionAnnotation));
    });

    const addToManualStartTime = performance.now();
    const existingAnnotationIds = new Set(manualAnnotations.map(annotation => annotation.id));
    const addedAnnotations = addAnnotations([...connectAnnotations, ...autoJunctions], {
        record: false,
        updateUi: options.suppressUi !== true
    });
    const finalizationResult = finalizeAddedAnnotations(addedAnnotations, {
        existingAnnotationIds,
        record: true,
        updateUi: options.suppressUi !== true
    });
    const addToManualMs = performance.now() - addToManualStartTime;
    const addedConnectAnnotations = finalizationResult.addedConnectAnnotations;
    const addedJunctionCount = finalizationResult.finalAddedAnnotations.filter(annotation => annotation.type === 'junction').length;
    const baseMessage = addedConnectAnnotations.length
        ? `Đã đưa ${addedConnectAnnotations.length} connect detect vào panel manual và tự thêm ${addedJunctionCount} junction.`
        : 'Các connect detect đã tồn tại hoặc bị connect lớn hơn bao phủ.';

    if (typeof applyManualLabelPanelState === 'function' && isManualLabelPanelCollapsed && options.openPanel !== false) {
        applyManualLabelPanelState(false);
    }

    let autoAcceptResult = {
        acceptedConnectCount: 0,
        acceptedJunctionCount: 0,
        timing: {
            totalMs: 0,
            roundBreakdown: []
        }
    };
    if (addedConnectAnnotations.length) {
        if (options.autoAcceptSuggestions === false) {
            requestSuggestedConnectAnnotations(addedConnectAnnotations, baseMessage);
        } else {
            autoAcceptResult = await autoAcceptSuggestedConnectAnnotationsFromSeeds(addedConnectAnnotations, baseMessage, {
                maxRounds: options.maxSuggestionRounds ?? 2,
                fullRecheckExistingConnects: options.fullRecheckExistingConnects,
                recheckFromAcceptedSuggestions: options.recheckFromAcceptedSuggestions,
                requestNextSuggestions: options.requestNextSuggestions,
                suppressUi: options.suppressUi === true,
                seedQueueAutoAccept: options.seedQueueAutoAccept === true
            });
        }
    } else {
        manualSuggestionRequestId += 1;
        setAnnotationFeedback(baseMessage, 'info');
        updateManualLabelUI();
        if (typeof scheduleDraw === 'function') scheduleDraw();
    }

    refreshAnnotationModeLabel();
    return {
        addedConnectCount: addedConnectAnnotations.length,
        addedJunctionCount,
        suggestionAcceptedConnectCount: autoAcceptResult.acceptedConnectCount || 0,
        suggestionAcceptedJunctionCount: autoAcceptResult.acceptedJunctionCount || 0,
        timing: {
            totalMs: performance.now() - promotionStartTime,
            addToManualMs,
            autoAcceptMs: autoAcceptResult?.timing?.totalMs || 0,
            autoAccept: autoAcceptResult?.timing || {
                totalMs: 0,
                roundBreakdown: []
            }
        }
    };
}

function deactivateManualLabelMode(options = {}) {
    annotationMode = null;
    hoveredSnapPoint = null;
    hoveredAnnotationId = null;
    suggestedConnectAnnotations = [];
    manualSuggestionRequestId += 1;
    resetPairCheckState();
    if (options.clearPending !== false) {
        pendingConnectPoint = null;
    }
    canvasContainer.classList.remove('annotation-junction-mode', 'annotation-connect-mode', 'annotation-pair-check-mode', 'annotation-delete-mode');
    refreshAnnotationModeLabel();
    updateManualLabelUI();
    if (typeof scheduleDraw === 'function') scheduleDraw();
}

async function setAnnotationMode(mode) {
    if (!jsonShapes || !jsonShapes.length) {
        setAnnotationFeedback('Chưa có dữ liệu để gán nhãn.', 'error');
        return;
    }

    if ((mode === 'junction' || mode === 'connect') && !hasManualLineCandidateSource()) {
        setAnnotationFeedback('Không tìm thấy cache shape/line để snap.', 'error');
        return;
    }

    if (mode === 'delete' && !manualAnnotations.length) {
        setAnnotationFeedback('Chưa có nhãn nào để xóa.', 'error');
        return;
    }

    if (mode === 'pair-check' && getManualLabelCounts().connect < 2) {
        setAnnotationFeedback('Cần ít nhất 2 connect annotation để kiểm tra cặp.', 'error');
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
    manualSuggestionRequestId += 1;
    resetPairCheckState();
    if (typeof applyManualLabelPanelState === 'function' && isManualLabelPanelCollapsed) {
        applyManualLabelPanelState(false);
    }
    hoveredSnapPoint = (mode === 'delete' || mode === 'pair-check')
        ? null
        : findNearestSnapPoint(mouseX, mouseY, { allowFallback: false });
    hoveredAnnotationId = mode === 'delete'
        ? (findNearestAnnotation(mouseX, mouseY)?.id || null)
        : mode === 'pair-check'
            ? (findNearestConnectAnnotation(mouseX, mouseY)?.id || null)
            : null;
    canvasContainer.classList.toggle('annotation-junction-mode', mode === 'junction');
    canvasContainer.classList.toggle('annotation-connect-mode', mode === 'connect');
    canvasContainer.classList.toggle('annotation-pair-check-mode', mode === 'pair-check');
    canvasContainer.classList.toggle('annotation-delete-mode', mode === 'delete');

    if (mode === 'connect') {
        setAnnotationFeedback('Chọn điểm 1 cho connect. Hệ thống sẽ gộp line hợp lệ và thêm junction ở mọi đầu mút của connect.', 'info');
    } else if (mode === 'junction') {
        setAnnotationFeedback('Click vào endpoint line để tạo junction.', 'info');
    } else if (mode === 'pair-check') {
        setAnnotationFeedback('Click 2 connect đã gán nhãn để kiểm tra xem khi vẽ 1 connect thì connect còn lại có được gợi ý không. Kết quả chi tiết được log ở console.', 'info');
    } else {
        setAnnotationFeedback('Click vào label muốn xóa. Ctrl+Z để phục hồi.', 'info');
    }

    if (mode === 'connect' || mode === 'junction') {
        scheduleSnapPointIndexWarmup();
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
    resetPairCheckState();
    hoveredSnapPoint = null;
    hoveredAnnotationId = null;
    manualSuggestionRequestId += 1;
    invalidateManualAnnotationSpatialIndex();
    annotationFeedbackMessage = options.message || '';
    annotationFeedbackTone = options.tone || 'info';

    if (options.clearMode !== false) {
        annotationMode = null;
        canvasContainer.classList.remove('annotation-junction-mode', 'annotation-connect-mode', 'annotation-pair-check-mode', 'annotation-delete-mode');
        refreshAnnotationModeLabel();
    }

    updateManualLabelUI();
    if (typeof scheduleDraw === 'function') scheduleDraw();
}

function undoManualAnnotation() {
    suggestedConnectAnnotations = [];
    manualSuggestionRequestId += 1;
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
    manualSuggestionRequestId += 1;
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
            return true;
        }
        return false;
    }

    if (annotationMode === 'delete') {
        const nextAnnotation = findNearestAnnotation(mouseX, mouseY);
        const nextId = nextAnnotation ? nextAnnotation.id : null;
        if (hoveredAnnotationId !== nextId) {
            hoveredAnnotationId = nextId;
            if (typeof scheduleDraw === 'function') scheduleDraw();
            hoveredSnapPoint = null;
            return true;
        }
        hoveredSnapPoint = null;
        return false;
    }

    if (annotationMode === 'pair-check') {
        const nextAnnotation = findNearestConnectAnnotation(mouseX, mouseY);
        const nextId = nextAnnotation ? nextAnnotation.id : null;
        if (hoveredAnnotationId !== nextId) {
            hoveredAnnotationId = nextId;
            if (typeof scheduleDraw === 'function') scheduleDraw();
            hoveredSnapPoint = null;
            return true;
        }
        hoveredSnapPoint = null;
        return false;
    }

    const requiredLayerName = annotationMode === 'connect' && pendingConnectPoint
        ? pendingConnectPoint.layerName
        : null;
    const nextPoint = findNearestSnapPoint(mouseX, mouseY, {
        layerName: requiredLayerName,
        allowFallback: false
    });
    const previousId = hoveredSnapPoint ? hoveredSnapPoint.id : null;
    const nextId = nextPoint ? nextPoint.id : null;
    hoveredSnapPoint = nextPoint;
    hoveredAnnotationId = null;
    if (previousId !== nextId && typeof scheduleDraw === 'function') {
        scheduleDraw();
        return true;
    }
    return previousId !== nextId;
}

function handleAnnotationCanvasClick(worldX, worldY) {
    if (!annotationMode) return false;

    if (annotationMode === 'delete') {
        return deleteAnnotationAtPoint(worldX, worldY);
    }

    if (annotationMode === 'pair-check') {
        return handleConnectPairCheckSelection(worldX, worldY);
    }

    const requiredLayerName = annotationMode === 'connect' && pendingConnectPoint
        ? pendingConnectPoint.layerName
        : null;
    const snapPoint = findNearestSnapPoint(worldX, worldY, {
        layerName: requiredLayerName,
        allowFallback: true
    });

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
        manualSuggestionRequestId += 1;
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
    const addedJunctionCount = finalizationResult.finalAddedAnnotations.filter(annotation => annotation.type === 'junction').length;
    const autoMessage = addedJunctionCount ? ` và tự thêm ${addedJunctionCount} junction` : '';
    pendingConnectPoint = null;
    hoveredSnapPoint = snapPoint;
    const baseMessage = !survivingConnects.length
        ? 'Connect lớn bị loại vì đã có các connect con bao phủ.'
        : `Đã thêm connect cho layer ${connectAnnotation.layerName}${autoMessage}.`;
    if (!survivingConnects.length) {
        manualSuggestionRequestId += 1;
        setAnnotationFeedback(baseMessage, 'info');
    } else {
        requestSuggestedConnectAnnotations(survivingConnects, baseMessage);
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
    if (isManualLabelPanelCollapsed) return;
    const radiusWorld = Math.max(3 / Math.max(zoom, 0.01), 1 / Math.max(zoom, 0.01));
    targetCtx.save();
    targetCtx.lineJoin = 'round';

    manualAnnotations.forEach(annotation => {
        if (!layerVisibility[annotation.layerName]) return;
        const polygon = getManualAnnotationWorldPolygon(annotation);
        if (!polygon) return;

        const isHovered = hoveredAnnotationId === annotation.id;
        const isPairCheckSelected = annotation.type === 'connect' && pairCheckSelectionIds.includes(annotation.id);
        const isPairCheckHover = annotationMode === 'pair-check' && isHovered;
        const isDeleteHover = isHovered && annotationMode === 'delete';
        const color = annotation.type === 'junction' ? MANUAL_LABEL_COLORS.junction : MANUAL_LABEL_COLORS.connect;
        let fillStyle = annotation.type === 'junction' ? 'rgba(239, 68, 68, 0.12)' : 'rgba(14, 165, 233, 0.12)';
        let strokeStyle = color;
        let lineWidth = 2 / Math.max(zoom, 0.01);

        if (isPairCheckSelected) {
            fillStyle = 'rgba(124, 58, 237, 0.14)';
            strokeStyle = MANUAL_LABEL_COLORS.pairCheckSelected;
            lineWidth = 2.5 / Math.max(zoom, 0.01);
        }
        if (isPairCheckHover) {
            fillStyle = 'rgba(139, 92, 246, 0.18)';
            strokeStyle = MANUAL_LABEL_COLORS.pairCheckHover;
            lineWidth = 2.5 / Math.max(zoom, 0.01);
        }
        if (isDeleteHover) {
            fillStyle = 'rgba(245, 158, 11, 0.18)';
            strokeStyle = MANUAL_LABEL_COLORS.delete;
        }

        targetCtx.fillStyle = fillStyle;
        targetCtx.strokeStyle = strokeStyle;
        targetCtx.lineWidth = lineWidth;
        if (isDeleteHover || isPairCheckHover) {
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

        const pointColor = isDeleteHover
            ? MANUAL_LABEL_COLORS.delete
            : isPairCheckHover
                ? MANUAL_LABEL_COLORS.pairCheckHover
                : isPairCheckSelected
                    ? MANUAL_LABEL_COLORS.pairCheckSelected
                    : color;
        annotation.points.forEach(point => drawWorldPoint(targetCtx, point, pointColor, radiusWorld));
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
        if (hoveredSnapPoint && layerVisibility[hoveredSnapPoint.layerName]) {
            targetCtx.strokeStyle = MANUAL_LABEL_COLORS.pending;
            targetCtx.lineWidth = 1.5 / Math.max(zoom, 0.01);
            targetCtx.setLineDash([4 / Math.max(zoom, 0.01), 4 / Math.max(zoom, 0.01)]);
            const previewPolygon = getManualAnnotationWorldPolygon({
                type: 'connect',
                points: [pendingConnectPoint, hoveredSnapPoint]
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
            targetCtx.lineTo(hoveredSnapPoint.x, hoveredSnapPoint.y);
            targetCtx.stroke();
            targetCtx.setLineDash([]);
        }
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

    const isAnnotationSelectionMode = annotationMode === 'delete' || annotationMode === 'pair-check';
    const anchorX = !isAnnotationSelectionMode && hoveredSnapPoint ? hoveredSnapPoint.x : mouseX;
    const anchorY = !isAnnotationSelectionMode && hoveredSnapPoint ? hoveredSnapPoint.y : mouseY;
    const screenX = anchorX * zoom + offsetX;
    const screenY = anchorY * zoom + offsetY;
    const lineColor = annotationMode === 'delete'
        ? MANUAL_LABEL_COLORS.delete
        : annotationMode === 'pair-check'
            ? (hoveredAnnotationId !== null ? MANUAL_LABEL_COLORS.pairCheckHover : MANUAL_LABEL_COLORS.pairCheckSelected)
            : (hoveredSnapPoint ? MANUAL_LABEL_COLORS.snap : MANUAL_LABEL_COLORS.idle);

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

    if (!isAnnotationSelectionMode && hoveredSnapPoint) {
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

window.addDetectedConnectAnnotationsToManualPanel = addDetectedConnectAnnotationsToManualPanel;
updateManualLabelUI();
