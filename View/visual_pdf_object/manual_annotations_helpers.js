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
    const nextAnnotation = {
        id: annotation.id,
        type: annotation.type,
        layerName: annotation.layerName,
        source: annotation.source || 'manual',
        autoManaged: Boolean(annotation.autoManaged),
        points: (annotation.points || []).map(cloneAnnotationPoint)
    };
    if (Array.isArray(annotation.lineKeys) && annotation.lineKeys.length) {
        nextAnnotation.lineKeys = annotation.lineKeys.map(lineKey => String(lineKey));
    }
    if (Array.isArray(annotation.segments) && annotation.segments.length) {
        nextAnnotation.segments = annotation.segments.map(segment =>
            Array.isArray(segment) ? segment.map(cloneAnnotationPoint) : []
        );
    }
    return nextAnnotation;
}

function getSnapPointKey(layerName, x, y) {
    return `${layerName}|${Number(x).toFixed(3)}|${Number(y).toFixed(3)}`;
}

function createNormalizedLineKey(layerName, pointA, pointB) {
    const endpointKeyA = getSnapPointKey(layerName, pointA.x, pointA.y);
    const endpointKeyB = getSnapPointKey(layerName, pointB.x, pointB.y);
    return endpointKeyA < endpointKeyB
        ? `${endpointKeyA}|${endpointKeyB}`
        : `${endpointKeyB}|${endpointKeyA}`;
}

function createLineCandidateBounds(pointA, pointB) {
    if (!pointA || !pointB) return null;

    const x1 = Number(pointA.x);
    const y1 = Number(pointA.y);
    const x2 = Number(pointB.x);
    const y2 = Number(pointB.y);
    if (![x1, y1, x2, y2].every(Number.isFinite)) return null;

    return {
        minX: Math.min(x1, x2),
        minY: Math.min(y1, y2),
        maxX: Math.max(x1, x2),
        maxY: Math.max(y1, y2)
    };
}

function getLineCandidateBounds(lineCandidate) {
    if (!lineCandidate) return null;
    if (lineCandidate.bbox) return lineCandidate.bbox;
    if (!Array.isArray(lineCandidate.points) || lineCandidate.points.length < 2) return null;
    return createLineCandidateBounds(lineCandidate.points[0], lineCandidate.points[1]);
}

function doBoundsIntersect(boundsA, boundsB) {
    if (!boundsA || !boundsB) return false;
    return !(
        boundsA.maxX < boundsB.minX
        || boundsA.minX > boundsB.maxX
        || boundsA.maxY < boundsB.minY
        || boundsA.minY > boundsB.maxY
    );
}

function expandBounds(bounds, paddingX = 0, paddingY = paddingX) {
    if (!bounds) return null;
    return {
        minX: bounds.minX - paddingX,
        minY: bounds.minY - paddingY,
        maxX: bounds.maxX + paddingX,
        maxY: bounds.maxY + paddingY
    };
}

function getPointsBounds(points) {
    if (!Array.isArray(points) || !points.length) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    points.forEach(point => {
        const x = Number(point?.x);
        const y = Number(point?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    });

    if (minX === Infinity) return null;
    return { minX, minY, maxX, maxY };
}

function getManualSuggestionSearchPadding() {
    return (CONFIG.MANUAL_LABEL_DASH_MAX_ENDPOINT_GAP || 0)
        + (CONFIG.MANUAL_LABEL_DASH_MAX_OFFSET || 0)
        + getDashedLineSegmentSoftMaxLength();
}

function getConnectAnnotationSearchBounds(annotation, padding = getManualSuggestionSearchPadding()) {
    const annotationPoints = Array.isArray(annotation?.points) ? annotation.points : [];
    const segmentPoints = getConnectAnnotationSegments(annotation)
        .flatMap(segment => Array.isArray(segment) ? segment : []);
    const bounds = getPointsBounds([...annotationPoints, ...segmentPoints]);
    return expandBounds(bounds, padding);
}

function queryLayerLineCandidates(layerName, queryRange = null) {
    if (!layerName) return [];

    const lineCandidates = snapPointLineItemsByLayer.get(layerName) || [];
    if (!queryRange) {
        return lineCandidates.slice();
    }

    const quadtree = snapPointLineQuadtreesByLayer.get(layerName);
    if (quadtree) {
        return Array.from(new Set(quadtree.query(queryRange)));
    }

    return lineCandidates.filter(lineCandidate => doBoundsIntersect(getLineCandidateBounds(lineCandidate), queryRange));
}

function getConnectLineKey(annotation) {
    if (!annotation || annotation.type !== 'connect' || !Array.isArray(annotation.points) || annotation.points.length < 2) {
        return null;
    }
    return createNormalizedLineKey(annotation.layerName, annotation.points[0], annotation.points[1]);
}

function createSuggestedConnectAnnotationFromLine(lineCandidate) {
    return {
        id: `suggested:${lineCandidate.id}`,
        type: 'connect',
        layerName: lineCandidate.layerName,
        source: 'suggested',
        autoManaged: false,
        points: lineCandidate.points.map(point => ({
            x: Number(point.x),
            y: Number(point.y),
            layerName: lineCandidate.layerName
        }))
    };
}

function hasSuggestedConnectAnnotations() {
    return Array.isArray(suggestedConnectAnnotations) && suggestedConnectAnnotations.length > 0;
}

function setSuggestedConnectAnnotations(nextSuggestions, options = {}) {
    suggestedConnectAnnotations = Array.isArray(nextSuggestions)
        ? nextSuggestions.map(cloneAnnotation)
        : [];
    updateManualLabelUI();
    if (options.redraw !== false && typeof scheduleDraw === 'function') {
        scheduleDraw();
    }
}

function clearSuggestedConnectAnnotations(options = {}) {
    if (!hasSuggestedConnectAnnotations()) return;
    suggestedConnectAnnotations = [];
    updateManualLabelUI();
    if (options.redraw !== false && typeof scheduleDraw === 'function') {
        scheduleDraw();
    }
}

function createAnnotation(type, layerName, points, options = {}) {
    manualAnnotationId += 1;
    const annotation = {
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
    if (Array.isArray(options.lineKeys) && options.lineKeys.length) {
        annotation.lineKeys = Array.from(new Set(options.lineKeys.map(lineKey => String(lineKey)))).sort();
    }
    if (Array.isArray(options.segments) && options.segments.length) {
        annotation.segments = options.segments.map(segment =>
            Array.isArray(segment)
                ? segment.map(point => ({
                    x: Number(point.x),
                    y: Number(point.y),
                    layerName
                }))
                : []
        );
    }
    return annotation;
}

function getConnectAnnotationLineKeys(annotation) {
    if (!annotation || annotation.type !== 'connect') return [];
    if (Array.isArray(annotation.lineKeys) && annotation.lineKeys.length) {
        return Array.from(new Set(annotation.lineKeys.map(lineKey => String(lineKey)))).sort();
    }
    const lineKey = getConnectLineKey(annotation);
    return lineKey ? [lineKey] : [];
}

function getConnectAnnotationGroupKey(annotation) {
    const lineKeys = getConnectAnnotationLineKeys(annotation);
    return lineKeys.length ? lineKeys.join('||') : null;
}

function getConnectAnnotationSegments(annotation) {
    if (Array.isArray(annotation?.segments) && annotation.segments.length) {
        return annotation.segments.map(segment =>
            Array.isArray(segment) ? segment.map(cloneAnnotationPoint) : []
        );
    }
    if (Array.isArray(annotation?.points) && annotation.points.length >= 2) {
        return [[cloneAnnotationPoint(annotation.points[0]), cloneAnnotationPoint(annotation.points[1])]];
    }
    return [];
}

function getConnectAnnotationLength(annotation) {
    return getConnectAnnotationSegments(annotation).reduce((totalLength, segment) => {
        if (!Array.isArray(segment) || segment.length < 2) return totalLength;
        return totalLength + Math.hypot(
            Number(segment[1].x) - Number(segment[0].x),
            Number(segment[1].y) - Number(segment[0].y)
        );
    }, 0);
}

function getConnectAnnotationEndpointKeys(annotation) {
    const endpointKeys = new Set();
    getConnectAnnotationLineKeys(annotation).forEach(lineKey => {
        const lineCandidate = snapPointLineItems.get(lineKey);
        if (!lineCandidate) return;
        lineCandidate.endpointKeys.forEach(endpointKey => endpointKeys.add(endpointKey));
    });

    if (!endpointKeys.size && Array.isArray(annotation?.points)) {
        annotation.points.forEach(point => {
            endpointKeys.add(getSnapPointKey(annotation.layerName, point.x, point.y));
        });
    }

    return Array.from(endpointKeys);
}

function getLineCandidateLength(lineCandidate) {
    if (!lineCandidate?.points || lineCandidate.points.length < 2) return 0;
    return Math.hypot(
        Number(lineCandidate.points[1].x) - Number(lineCandidate.points[0].x),
        Number(lineCandidate.points[1].y) - Number(lineCandidate.points[0].y)
    );
}

function getLineCandidateUnitDirection(lineCandidate) {
    const length = getLineCandidateLength(lineCandidate);
    if (length <= 1e-6) return null;
    return {
        x: (Number(lineCandidate.points[1].x) - Number(lineCandidate.points[0].x)) / length,
        y: (Number(lineCandidate.points[1].y) - Number(lineCandidate.points[0].y)) / length
    };
}

function areParallelLineCandidates(lineCandidateA, lineCandidateB) {
    const directionA = getLineCandidateUnitDirection(lineCandidateA);
    const directionB = getLineCandidateUnitDirection(lineCandidateB);
    if (!directionA || !directionB) return false;
    const dot = (directionA.x * directionB.x) + (directionA.y * directionB.y);
    return Math.abs(dot) >= 0.98;
}

function getLineCandidateSeqnoGroupIds(lineCandidate) {
    if (!Array.isArray(lineCandidate?.seqnoGroupIds) || !lineCandidate.seqnoGroupIds.length) return [];
    return Array.from(new Set(
        lineCandidate.seqnoGroupIds.filter(groupId => groupId !== null && groupId !== undefined)
    ));
}

function getDashedLineSegmentMaxLength() {
    return CONFIG.MANUAL_LABEL_DASH_SEGMENT_MAX_LENGTH
        || CONFIG.MANUAL_LABEL_MIN_SUGGEST_CONNECT_LENGTH
        || 0;
}

function getDashedLineSegmentSoftMaxLength() {
    const baseMaxLength = getDashedLineSegmentMaxLength();
    const toleranceRatio = Math.max(CONFIG.MANUAL_LABEL_DASH_SEGMENT_LENGTH_TOLERANCE_RATIO || 1, 1);
    return baseMaxLength * toleranceRatio;
}

function isShortDashedLineCandidate(lineCandidate) {
    const maxLength = getDashedLineSegmentSoftMaxLength();
    const length = getLineCandidateLength(lineCandidate);
    return maxLength > 0 && length > 1e-6 && length <= maxLength;
}

function doLineCandidatesShareDashGroup(lineCandidateA, lineCandidateB) {
    const dashGroupIdsA = getLineCandidateSeqnoGroupIds(lineCandidateA);
    const dashGroupIdsB = getLineCandidateSeqnoGroupIds(lineCandidateB);
    if (!dashGroupIdsA.length || !dashGroupIdsB.length) return false;
    const dashGroupIdSetA = new Set(dashGroupIdsA);
    return dashGroupIdsB.some(groupId => dashGroupIdSetA.has(groupId));
}

function getLineCandidateProjectionRange(lineCandidate, originPoint, direction) {
    if (!lineCandidate?.points || lineCandidate.points.length < 2 || !originPoint || !direction) {
        return [0, 0];
    }
    const projections = lineCandidate.points.slice(0, 2).map(point =>
        ((Number(point.x) - Number(originPoint.x)) * direction.x)
        + ((Number(point.y) - Number(originPoint.y)) * direction.y)
    ).sort((left, right) => left - right);
    return [projections[0], projections[1]];
}

function getLineCandidateFacingEndpoint(lineCandidate, originPoint, direction, preferMaxProjection) {
    if (!lineCandidate?.points || lineCandidate.points.length < 2 || !originPoint || !direction) return null;
    const projectedPoints = lineCandidate.points.slice(0, 2).map(point => ({
        point,
        projection: ((Number(point.x) - Number(originPoint.x)) * direction.x)
            + ((Number(point.y) - Number(originPoint.y)) * direction.y)
    }));
    projectedPoints.sort((left, right) => left.projection - right.projection);
    const target = preferMaxProjection ? projectedPoints[projectedPoints.length - 1] : projectedPoints[0];
    return target?.point || null;
}

function getLineCandidateAxisOffset(lineCandidate, originPoint, direction) {
    if (!lineCandidate?.points || lineCandidate.points.length < 2 || !originPoint || !direction) {
        return Infinity;
    }
    return Math.max(...lineCandidate.points.slice(0, 2).map(point => Math.abs(
        ((Number(point.x) - Number(originPoint.x)) * (-direction.y))
        + ((Number(point.y) - Number(originPoint.y)) * direction.x)
    )));
}

function getDashedLineCandidateCompatibility(referenceLineCandidate, lineCandidateA, lineCandidateB) {
    if (!referenceLineCandidate || !lineCandidateA || !lineCandidateB) return null;
    if (lineCandidateA.id === lineCandidateB.id) return null;
    if (lineCandidateA.layerName !== lineCandidateB.layerName || lineCandidateA.layerName !== referenceLineCandidate.layerName) {
        return null;
    }
    if (!isShortDashedLineCandidate(lineCandidateA) || !isShortDashedLineCandidate(lineCandidateB)) return null;
    if (!areParallelLineCandidates(referenceLineCandidate, lineCandidateA) || !areParallelLineCandidates(referenceLineCandidate, lineCandidateB)) {
        return null;
    }

    const direction = getLineCandidateUnitDirection(referenceLineCandidate);
    if (!direction) return null;
    const originPoint = referenceLineCandidate.points[0];
    const maxOffset = CONFIG.MANUAL_LABEL_DASH_MAX_OFFSET || 0;
    const axisOffsetA = getLineCandidateAxisOffset(lineCandidateA, originPoint, direction);
    const axisOffsetB = getLineCandidateAxisOffset(lineCandidateB, originPoint, direction);
    if (axisOffsetA > maxOffset || axisOffsetB > maxOffset) return null;

    const [aMin, aMax] = getLineCandidateProjectionRange(lineCandidateA, originPoint, direction);
    const [bMin, bMax] = getLineCandidateProjectionRange(lineCandidateB, originPoint, direction);
    const maxGap = CONFIG.MANUAL_LABEL_DASH_MAX_ENDPOINT_GAP || 0;

    let gap = Infinity;
    let side = null;
    let facingPointA = null;
    let facingPointB = null;
    if (aMax <= bMin) {
        side = 'forward';
        gap = bMin - aMax;
        facingPointA = getLineCandidateFacingEndpoint(lineCandidateA, originPoint, direction, true);
        facingPointB = getLineCandidateFacingEndpoint(lineCandidateB, originPoint, direction, false);
    } else if (bMax <= aMin) {
        side = 'backward';
        gap = aMin - bMax;
        facingPointA = getLineCandidateFacingEndpoint(lineCandidateA, originPoint, direction, false);
        facingPointB = getLineCandidateFacingEndpoint(lineCandidateB, originPoint, direction, true);
    }

    if (!side || !Number.isFinite(gap) || gap > maxGap) return null;
    if (!facingPointA || !facingPointB) return null;

    const lateralOffset = Math.abs(
        ((Number(facingPointB.x) - Number(facingPointA.x)) * (-direction.y))
        + ((Number(facingPointB.y) - Number(facingPointA.y)) * direction.x)
    );
    if (lateralOffset > maxOffset) return null;

    return {
        side,
        gap,
        lateralOffset,
        sharedDashGroup: doLineCandidatesShareDashGroup(lineCandidateA, lineCandidateB),
        score: gap + lateralOffset
    };
}

function areDashedLineCandidatesContinuations(referenceLineCandidate, lineCandidateA, lineCandidateB) {
    return Boolean(getDashedLineCandidateCompatibility(referenceLineCandidate, lineCandidateA, lineCandidateB));
}

function getDashedAlignedNeighborLineCandidates(currentLineCandidate, referenceLineCandidate, existingConnectLineKeys) {
    if (!currentLineCandidate || !referenceLineCandidate) return [];
    if (!isShortDashedLineCandidate(currentLineCandidate)) return [];

    const bestSharedNeighborBySide = new Map();
    const bestFallbackNeighborBySide = new Map();
    const queryRange = expandBounds(
        getLineCandidateBounds(currentLineCandidate),
        getManualSuggestionSearchPadding()
    );
    queryLayerLineCandidates(currentLineCandidate.layerName, queryRange).forEach(lineCandidate => {
        if (!lineCandidate || lineCandidate.id === currentLineCandidate.id) return;
        if (existingConnectLineKeys.has(lineCandidate.id)) return;
        const compatibility = getDashedLineCandidateCompatibility(referenceLineCandidate, currentLineCandidate, lineCandidate);
        if (!compatibility) return;

        const targetMap = compatibility.sharedDashGroup ? bestSharedNeighborBySide : bestFallbackNeighborBySide;
        const previousBest = targetMap.get(compatibility.side);
        if (!previousBest || compatibility.score < previousBest.compatibility.score) {
            targetMap.set(compatibility.side, { lineCandidate, compatibility });
        }
    });

    return ['backward', 'forward']
        .map(side => bestSharedNeighborBySide.get(side) || bestFallbackNeighborBySide.get(side))
        .filter(Boolean)
        .map(entry => entry.lineCandidate);
}

function getSameLayerLineCandidatesForEndpoint(endpointKey, layerName) {
    if (!layerName) return [];
    const lineCandidates = snapPointLineCandidates.get(endpointKey);
    return Array.isArray(lineCandidates) ? lineCandidates : [];
}

function getReferenceLineCandidateForLines(lineCandidates) {
    return lineCandidates
        .slice()
        .sort((left, right) => getLineCandidateLength(right) - getLineCandidateLength(left))[0] || null;
}

function isStraightThroughEndpoint(endpointKey, layerName, referenceLineCandidate, groupedLineKeySet = null) {
    if (!referenceLineCandidate) return false;
    const sameLayerLineCandidates = getSameLayerLineCandidatesForEndpoint(endpointKey, layerName);
    if (sameLayerLineCandidates.length !== 2) return false;
    if (!sameLayerLineCandidates.every(lineCandidate => areParallelLineCandidates(referenceLineCandidate, lineCandidate))) {
        return false;
    }
    if (groupedLineKeySet instanceof Set) {
        return sameLayerLineCandidates.every(lineCandidate => groupedLineKeySet.has(lineCandidate.id));
    }
    return true;
}

function isJunctionEndpoint(endpointKey, layerName, referenceLineCandidate) {
    if (!referenceLineCandidate) return false;
    const sameLayerLineCandidates = getSameLayerLineCandidatesForEndpoint(endpointKey, layerName);
    if (sameLayerLineCandidates.length < 2) return false;
    if (sameLayerLineCandidates.length !== 2) return true;
    return !sameLayerLineCandidates.every(lineCandidate => areParallelLineCandidates(referenceLineCandidate, lineCandidate));
}

function pickMergedConnectEndpointsFromLines(lineCandidates) {
    const referenceLineCandidate = getReferenceLineCandidateForLines(lineCandidates);
    const groupedLineKeySet = new Set(lineCandidates.map(lineCandidate => lineCandidate.id));
    const exposedEndpointMap = new Map();

    lineCandidates.forEach(lineCandidate => {
        lineCandidate.points.forEach((point, pointIndex) => {
            const endpointKey = lineCandidate.endpointKeys?.[pointIndex]
                || getSnapPointKey(lineCandidate.layerName, point.x, point.y);
            if (isStraightThroughEndpoint(endpointKey, lineCandidate.layerName, referenceLineCandidate, groupedLineKeySet)) {
                return;
            }
            if (!exposedEndpointMap.has(endpointKey)) {
                exposedEndpointMap.set(endpointKey, cloneAnnotationPoint(point));
            }
        });
    });

    const exposedEndpoints = Array.from(exposedEndpointMap.values());

    if (exposedEndpoints.length === 2) {
        return exposedEndpoints;
    }

    const baseLineCandidate = referenceLineCandidate;
    const baseDirection = getLineCandidateUnitDirection(baseLineCandidate);
    if (!baseDirection) {
        return lineCandidates[0]?.points?.slice(0, 2).map(cloneAnnotationPoint) || [];
    }

    let minProjectionPoint = null;
    let maxProjectionPoint = null;
    let minProjection = Infinity;
    let maxProjection = -Infinity;
    const origin = baseLineCandidate.points[0];

    lineCandidates.forEach(lineCandidate => {
        lineCandidate.points.forEach(point => {
            const projection = ((point.x - origin.x) * baseDirection.x) + ((point.y - origin.y) * baseDirection.y);
            if (projection < minProjection) {
                minProjection = projection;
                minProjectionPoint = cloneAnnotationPoint(point);
            }
            if (projection > maxProjection) {
                maxProjection = projection;
                maxProjectionPoint = cloneAnnotationPoint(point);
            }
        });
    });

    return [minProjectionPoint, maxProjectionPoint].filter(Boolean);
}

function createConnectAnnotationFromLineCandidates(lineCandidates, options = {}) {
    if (!Array.isArray(lineCandidates) || !lineCandidates.length) return null;

    const normalizedLineCandidates = Array.from(new Map(
        lineCandidates
            .filter(lineCandidate => lineCandidate?.layerName && Array.isArray(lineCandidate.points) && lineCandidate.points.length >= 2)
            .map(lineCandidate => [lineCandidate.id, {
                id: String(lineCandidate.id),
                layerName: lineCandidate.layerName,
                points: lineCandidate.points.slice(0, 2).map(point => ({
                    x: Number(point.x),
                    y: Number(point.y),
                    layerName: lineCandidate.layerName
                })),
                endpointKeys: Array.isArray(lineCandidate.endpointKeys) && lineCandidate.endpointKeys.length
                    ? lineCandidate.endpointKeys.map(endpointKey => String(endpointKey))
                    : lineCandidate.points.slice(0, 2).map(point => getSnapPointKey(lineCandidate.layerName, point.x, point.y))
            }])
    ).values());

    if (!normalizedLineCandidates.length) return null;
    const layerName = normalizedLineCandidates[0].layerName;
    const mergedEndpoints = pickMergedConnectEndpointsFromLines(normalizedLineCandidates);
    if (mergedEndpoints.length < 2) return null;

    const annotationOptions = {
        source: options.source || 'manual',
        autoManaged: Boolean(options.autoManaged),
        lineKeys: normalizedLineCandidates.map(lineCandidate => lineCandidate.id),
        segments: normalizedLineCandidates.map(lineCandidate => lineCandidate.points)
    };

    if (options.id !== undefined) {
        return {
            id: options.id,
            type: 'connect',
            layerName,
            source: annotationOptions.source,
            autoManaged: annotationOptions.autoManaged,
            points: mergedEndpoints.map(point => ({
                x: Number(point.x),
                y: Number(point.y),
                layerName
            })),
            lineKeys: annotationOptions.lineKeys,
            segments: annotationOptions.segments.map(segment => segment.map(cloneAnnotationPoint))
        };
    }

    return createAnnotation('connect', layerName, mergedEndpoints, annotationOptions);
}

function getReferenceLineCandidateForAnnotation(annotation) {
    const lineCandidates = getConnectAnnotationLineKeys(annotation)
        .map(lineKey => snapPointLineItems.get(lineKey))
        .filter(Boolean);
    if (lineCandidates.length) {
        return getReferenceLineCandidateForLines(lineCandidates);
    }

    const fallbackLineCandidates = getConnectAnnotationSegments(annotation)
        .filter(segment => Array.isArray(segment) && segment.length >= 2)
        .map((segment, segmentIndex) => ({
            id: `segment:${annotation.id}:${segmentIndex}`,
            layerName: annotation.layerName,
            points: segment.map(cloneAnnotationPoint),
            endpointKeys: segment.map(point => getSnapPointKey(annotation.layerName, point.x, point.y))
        }));
    return getReferenceLineCandidateForLines(fallbackLineCandidates);
}

function getConnectAnnotationBoundaryEndpointKeys(annotation) {
    return new Set(
        (annotation?.points || []).map(point => getSnapPointKey(annotation.layerName, point.x, point.y))
    );
}

function getConnectAnnotationVirtualSegments(annotation) {
    if (Array.isArray(annotation?.points) && annotation.points.length >= 2) {
        return [[
            cloneAnnotationPoint(annotation.points[0]),
            cloneAnnotationPoint(annotation.points[1])
        ]];
    }

    return getConnectAnnotationSegments(annotation);
}

function getConnectAnnotationInternalEndpointKeys(annotation) {
    const boundaryEndpointKeys = getConnectAnnotationBoundaryEndpointKeys(annotation);
    return getConnectAnnotationEndpointKeys(annotation)
        .filter(endpointKey => !boundaryEndpointKeys.has(endpointKey));
}

function getManualLineAttachToleranceWorld() {
    return 1e-4;
}

function isPointOnSegmentInterior(point, segmentStart, segmentEnd, tolerance = getManualLineAttachToleranceWorld()) {
    if (!point || !segmentStart || !segmentEnd) return false;
    const dx = Number(segmentEnd.x) - Number(segmentStart.x);
    const dy = Number(segmentEnd.y) - Number(segmentStart.y);
    const lengthSquared = (dx * dx) + (dy * dy);
    if (lengthSquared <= 1e-6) return false;

    const offsetX = Number(point.x) - Number(segmentStart.x);
    const offsetY = Number(point.y) - Number(segmentStart.y);
    const projection = ((offsetX * dx) + (offsetY * dy)) / lengthSquared;
    const segmentLength = Math.sqrt(lengthSquared);
    const normalizedEdgeTolerance = Math.min(tolerance / Math.max(segmentLength, tolerance), 0.499999);
    if (projection <= normalizedEdgeTolerance || projection >= 1 - normalizedEdgeTolerance) return false;

    return distancePointToSegment(
        Number(point.x),
        Number(point.y),
        Number(segmentStart.x),
        Number(segmentStart.y),
        Number(segmentEnd.x),
        Number(segmentEnd.y)
    ) <= tolerance;
}

function doesLineCandidateTouchConnectInterior(lineCandidate, connectAnnotation) {
    if (!lineCandidate || !connectAnnotation || lineCandidate.layerName !== connectAnnotation.layerName) return false;
    const boundaryEndpointKeys = getConnectAnnotationBoundaryEndpointKeys(connectAnnotation);
    const probeSegments = getConnectAnnotationVirtualSegments(connectAnnotation);
    if (!probeSegments.length) return false;
    return lineCandidate.points.some(point => {
        const endpointKey = getSnapPointKey(connectAnnotation.layerName, point.x, point.y);
        if (boundaryEndpointKeys.has(endpointKey)) return false;
        return probeSegments.some(segment =>
            Array.isArray(segment)
                && segment.length >= 2
                && isPointOnSegmentInterior(point, segment[0], segment[1])
        );
    });
}

function doesConnectBoundaryTouchLineCandidateInterior(connectAnnotation, lineCandidate) {
    if (!connectAnnotation || !lineCandidate || connectAnnotation.layerName !== lineCandidate.layerName) return false;
    if (!Array.isArray(connectAnnotation?.points) || connectAnnotation.points.length < 2) return false;
    if (!Array.isArray(lineCandidate?.points) || lineCandidate.points.length < 2) return false;

    const lineEndpointKeys = new Set(
        (Array.isArray(lineCandidate.endpointKeys) && lineCandidate.endpointKeys.length
            ? lineCandidate.endpointKeys
            : lineCandidate.points.slice(0, 2).map(point => getSnapPointKey(lineCandidate.layerName, point.x, point.y)))
            .map(endpointKey => String(endpointKey))
    );

    return connectAnnotation.points.some(point => {
        const endpointKey = getSnapPointKey(connectAnnotation.layerName, point.x, point.y);
        if (lineEndpointKeys.has(endpointKey)) return false;
        return isPointOnSegmentInterior(point, lineCandidate.points[0], lineCandidate.points[1]);
    });
}

function collectExistingConnectLineKeys(annotations) {
    const lineKeys = new Set();
    (annotations || []).forEach(annotation => {
        if (annotation?.type !== 'connect') return;
        getConnectAnnotationLineKeys(annotation).forEach(lineKey => lineKeys.add(lineKey));
    });
    return lineKeys;
}

function collectStraightGroupedLineCandidates(seedLineCandidate, existingConnectLineKeys) {
    const groupedLineCandidates = [];
    const queuedLineCandidates = [seedLineCandidate];
    const seenLineKeys = new Set();

    while (queuedLineCandidates.length) {
        const currentLineCandidate = queuedLineCandidates.shift();
        if (!currentLineCandidate || seenLineKeys.has(currentLineCandidate.id)) continue;
        seenLineKeys.add(currentLineCandidate.id);
        if (currentLineCandidate.layerName !== seedLineCandidate.layerName) continue;
        if (existingConnectLineKeys.has(currentLineCandidate.id)) continue;
        if (!areParallelLineCandidates(seedLineCandidate, currentLineCandidate)) continue;

        groupedLineCandidates.push(currentLineCandidate);
        currentLineCandidate.endpointKeys.forEach(nextEndpointKey => {
            if (!isStraightThroughEndpoint(nextEndpointKey, currentLineCandidate.layerName, seedLineCandidate)) {
                return;
            }
            const adjacentLineCandidates = getSameLayerLineCandidatesForEndpoint(nextEndpointKey, currentLineCandidate.layerName);
            adjacentLineCandidates.forEach(adjacentLineCandidate => {
                if (!adjacentLineCandidate || seenLineKeys.has(adjacentLineCandidate.id)) return;
                if (adjacentLineCandidate.layerName !== seedLineCandidate.layerName) return;
                if (existingConnectLineKeys.has(adjacentLineCandidate.id)) return;
                if (!areParallelLineCandidates(seedLineCandidate, adjacentLineCandidate)) return;
                queuedLineCandidates.push(adjacentLineCandidate);
            });
        });

        getDashedAlignedNeighborLineCandidates(currentLineCandidate, seedLineCandidate, existingConnectLineKeys).forEach(adjacentLineCandidate => {
            if (!adjacentLineCandidate || seenLineKeys.has(adjacentLineCandidate.id)) return;
            queuedLineCandidates.push(adjacentLineCandidate);
        });
    }

    return groupedLineCandidates;
}

function buildConnectSuggestionsFromSeedLines(seedLineCandidates, existingConnectLineKeys) {
    const consumedLineKeys = new Set();
    const suggestionGroupKeys = new Set();
    const suggestions = [];

    seedLineCandidates.forEach(seedLineCandidate => {
        if (!seedLineCandidate || consumedLineKeys.has(seedLineCandidate.id) || existingConnectLineKeys.has(seedLineCandidate.id)) {
            return;
        }

        const groupedLineCandidates = collectStraightGroupedLineCandidates(seedLineCandidate, existingConnectLineKeys);
        const suggestion = createConnectAnnotationFromLineCandidates(groupedLineCandidates, {
            id: `suggested:${groupedLineCandidates.map(candidate => candidate.id).sort().join('||')}`,
            source: 'suggested',
            autoManaged: false
        });
        if (!suggestion) return;
        if (getConnectAnnotationLength(suggestion) < (CONFIG.MANUAL_LABEL_MIN_SUGGEST_CONNECT_LENGTH || 0)) return;

        const groupKey = getConnectAnnotationGroupKey(suggestion);
        if (groupKey && suggestionGroupKeys.has(groupKey)) return;
        if (groupKey) suggestionGroupKeys.add(groupKey);
        getConnectAnnotationLineKeys(suggestion).forEach(groupedLineKey => {
            consumedLineKeys.add(groupedLineKey);
        });
        suggestions.push(suggestion);
    });

    return suggestions;
}

function collectStraightConnectSuggestionSeeds(connectAnnotations, existingConnectLineKeys) {
    const seedLineCandidates = new Map();
    connectAnnotations.forEach(annotation => {
        if (!annotation || annotation.type !== 'connect') return;
        const referenceLineCandidate = getReferenceLineCandidateForAnnotation(annotation);
        getConnectAnnotationEndpointKeys(annotation).forEach(endpointKey => {
            const connectedLines = getSameLayerLineCandidatesForEndpoint(endpointKey, annotation.layerName);
            connectedLines.forEach(lineCandidate => {
                if (!lineCandidate || existingConnectLineKeys.has(lineCandidate.id)) return;
                if (referenceLineCandidate && !areParallelLineCandidates(referenceLineCandidate, lineCandidate)) return;
                seedLineCandidates.set(lineCandidate.id, lineCandidate);
            });
        });
    });
    return Array.from(seedLineCandidates.values());
}

function collectTeeConnectSuggestionSeeds(connectAnnotations, existingConnectLineKeys) {
    const seedLineCandidates = new Map();

    connectAnnotations.forEach(annotation => {
        if (!annotation || annotation.type !== 'connect') return;
        const referenceLineCandidate = getReferenceLineCandidateForAnnotation(annotation);
        if (!referenceLineCandidate) return;
        const nearbyLineCandidates = queryLayerLineCandidates(
            annotation.layerName,
            getConnectAnnotationSearchBounds(annotation)
        );

        getConnectAnnotationEndpointKeys(annotation)
            .filter(endpointKey => isJunctionEndpoint(endpointKey, annotation.layerName, referenceLineCandidate))
            .forEach(endpointKey => {
                const connectedLines = getSameLayerLineCandidatesForEndpoint(endpointKey, annotation.layerName);
                connectedLines.forEach(lineCandidate => {
                    if (!lineCandidate || existingConnectLineKeys.has(lineCandidate.id)) return;
                    if (areParallelLineCandidates(referenceLineCandidate, lineCandidate)) return;
                    seedLineCandidates.set(lineCandidate.id, lineCandidate);
                });
            });

        nearbyLineCandidates.forEach(lineCandidate => {
            if (!lineCandidate) return;
            if (existingConnectLineKeys.has(lineCandidate.id) || seedLineCandidates.has(lineCandidate.id)) return;
            if (areParallelLineCandidates(referenceLineCandidate, lineCandidate)) return;
            const touchesConnectInterior = doesLineCandidateTouchConnectInterior(lineCandidate, annotation);
            const touchesLineInterior = doesConnectBoundaryTouchLineCandidateInterior(annotation, lineCandidate);
            if (!touchesConnectInterior && !touchesLineInterior) return;
            seedLineCandidates.set(lineCandidate.id, lineCandidate);
        });
    });

    return Array.from(seedLineCandidates.values());
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