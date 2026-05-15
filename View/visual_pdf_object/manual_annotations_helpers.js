function isExportableAnnotationLayer(layerName) {
    return Boolean(layerName)
        && !layerName.startsWith('svg_')
        && !pipelineLayerNames.includes(layerName)
        && !detectionLayerNames.includes(layerName);
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
    + getDashedLineSegmentSoftMaxLength()
    + getManualLineAttachToleranceWorld();
}

function getConnectAnnotationSearchBounds(annotation, padding = getManualSuggestionSearchPadding()) {
    const annotationPoints = Array.isArray(annotation?.points) ? annotation.points : [];
    const segmentPoints = getConnectAnnotationSegments(annotation)
        .flatMap(segment => Array.isArray(segment) ? segment : []);
    const bounds = getPointsBounds([...annotationPoints, ...segmentPoints]);
    return expandBounds(bounds, padding);
}

function hasManualLineCandidateSource() {
    return Boolean(
        (shapeQuadtree && Array.isArray(allShapesSorted) && allShapesSorted.length)
        || (Array.isArray(allShapesSorted) && allShapesSorted.length)
    );
}

function createLineCandidateFromShapeItem(shape, item, layerName) {
    if (!shape || !Array.isArray(item) || item[0] !== 'l') return null;
    const rawPointA = Array.isArray(item[1]) ? item[1] : null;
    const rawPointB = Array.isArray(item[2]) ? item[2] : null;
    if (!rawPointA || !rawPointB || rawPointA.length < 2 || rawPointB.length < 2) return null;

    const pointA = { x: Number(rawPointA[0]), y: Number(rawPointA[1]), layerName };
    const pointB = { x: Number(rawPointB[0]), y: Number(rawPointB[1]), layerName };
    if (!Number.isFinite(pointA.x) || !Number.isFinite(pointA.y) || !Number.isFinite(pointB.x) || !Number.isFinite(pointB.y)) {
        return null;
    }

    const bbox = createLineCandidateBounds(pointA, pointB);
    if (!bbox) return null;

    const shapeSeqnoValue = Number(shape.seqno);
    const shapeSeqno = Number.isFinite(shapeSeqnoValue) ? shapeSeqnoValue : null;
    const shapeSeqnoGroup = shapeSeqno !== null && Object.prototype.hasOwnProperty.call(seqnoGroups, shapeSeqno)
        ? seqnoGroups[shapeSeqno]
        : null;

    return {
        id: createNormalizedLineKey(layerName, pointA, pointB),
        layerName,
        points: [pointA, pointB],
        bbox,
        endpointKeys: [
            getSnapPointKey(layerName, pointA.x, pointA.y),
            getSnapPointKey(layerName, pointB.x, pointB.y)
        ],
        seqnos: shapeSeqno !== null ? [shapeSeqno] : [],
        seqnoGroupIds: shapeSeqnoGroup !== null ? [shapeSeqnoGroup] : []
    };
}

function mergeLineCandidateMetadata(targetLineCandidate, sourceLineCandidate) {
    if (!targetLineCandidate || !sourceLineCandidate) return targetLineCandidate;
    (sourceLineCandidate.seqnos || []).forEach(seqno => {
        if (!targetLineCandidate.seqnos.includes(seqno)) {
            targetLineCandidate.seqnos.push(seqno);
        }
    });
    (sourceLineCandidate.seqnoGroupIds || []).forEach(groupId => {
        if (!targetLineCandidate.seqnoGroupIds.includes(groupId)) {
            targetLineCandidate.seqnoGroupIds.push(groupId);
        }
    });
    return targetLineCandidate;
}

function queryLineCandidatesFromSharedShapeCache(layerName = null, queryRange = null) {
    if (!hasManualLineCandidateSource()) return [];

    const sourceShapes = queryRange && shapeQuadtree
        ? Array.from(new Set(shapeQuadtree.query(queryRange)))
        : (layerName && Array.isArray(layerIndex?.[layerName]) && layerIndex[layerName].length
            ? layerIndex[layerName]
            : (Array.isArray(allShapesSorted) ? allShapesSorted : []));
    const uniqueLines = new Map();

    sourceShapes.forEach(shape => {
        const shapeLayerName = getShapeLayerNameForField(shape, currentLayerField);
        if ((layerName && shapeLayerName !== layerName) || !isExportableAnnotationLayer(shapeLayerName) || !Array.isArray(shape.items)) return;
        if (typeof layerVisibility === 'object' && layerVisibility && layerVisibility[shapeLayerName] === false) return;

        shape.items.forEach(item => {
            const lineCandidate = createLineCandidateFromShapeItem(shape, item, shapeLayerName);
            if (!lineCandidate) return;
            if (queryRange && !doBoundsIntersect(lineCandidate.bbox, queryRange)) return;

            const existingLineCandidate = uniqueLines.get(lineCandidate.id);
            if (existingLineCandidate) {
                mergeLineCandidateMetadata(existingLineCandidate, lineCandidate);
            } else {
                uniqueLines.set(lineCandidate.id, lineCandidate);
            }
        });
    });

    return Array.from(uniqueLines.values());
}

function queryLayerLineCandidates(layerName, queryRange = null) {
    if (!layerName) return [];

    const lineCandidates = snapPointLineItemsByLayer.get(layerName) || [];
    if (lineCandidates.length && !queryRange) {
        return lineCandidates.slice();
    }

    const quadtree = snapPointLineQuadtreesByLayer.get(layerName);
    if (quadtree) {
        return Array.from(new Set(quadtree.query(queryRange)));
    }

    if (lineCandidates.length) {
        return lineCandidates.filter(lineCandidate => doBoundsIntersect(getLineCandidateBounds(lineCandidate), queryRange));
    }

    if (typeof snapPointIndexReady !== 'undefined' && snapPointIndexReady) {
        return [];
    }

    return queryLineCandidatesFromSharedShapeCache(layerName, queryRange);
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

function getConnectAnnotationVirtualLength(annotation) {
    if (!Array.isArray(annotation?.points) || annotation.points.length < 2) return 0;
    return Math.hypot(
        Number(annotation.points[1].x) - Number(annotation.points[0].x),
        Number(annotation.points[1].y) - Number(annotation.points[0].y)
    );
}

function getConnectAnnotationEffectiveLength(annotation) {
    return Math.max(
        getConnectAnnotationLength(annotation),
        getConnectAnnotationVirtualLength(annotation)
    );
}

function isPointNearAnyLineSegment(point, segments, tolerance = getManualEndpointTouchToleranceWorld()) {
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

function doesConnectAnnotationGeometricallyCover(parentAnnotation, childAnnotation, tolerance = getManualEndpointTouchToleranceWorld()) {
    if (!parentAnnotation || !childAnnotation || parentAnnotation.type !== 'connect' || childAnnotation.type !== 'connect') return false;
    if (parentAnnotation.id === childAnnotation.id || parentAnnotation.layerName !== childAnnotation.layerName) return false;

    const parentReferenceLineCandidate = getReferenceLineCandidateForAnnotation(parentAnnotation);
    const childReferenceLineCandidate = getReferenceLineCandidateForAnnotation(childAnnotation);
    if (!parentReferenceLineCandidate || !childReferenceLineCandidate) return false;
    if (!areParallelLineCandidates(parentReferenceLineCandidate, childReferenceLineCandidate)) return false;

    const parentLength = getConnectAnnotationEffectiveLength(parentAnnotation);
    const childLength = getConnectAnnotationEffectiveLength(childAnnotation);
    const minimumLengthGain = Math.max(tolerance, 1e-4);
    if (!(parentLength > childLength + minimumLengthGain)) return false;

    const parentSegments = getConnectAnnotationVirtualSegments(parentAnnotation);
    const childSegments = getConnectAnnotationVirtualSegments(childAnnotation);
    if (!parentSegments.length || !childSegments.length) return false;

    return childSegments.every(segment => {
        if (!Array.isArray(segment) || segment.length < 2) return false;
        const midpoint = {
            x: (Number(segment[0].x) + Number(segment[1].x)) / 2,
            y: (Number(segment[0].y) + Number(segment[1].y)) / 2,
            layerName: childAnnotation.layerName
        };
        return [segment[0], midpoint, segment[1]].every(point =>
            isPointNearAnyLineSegment(point, parentSegments, tolerance)
        );
    });
}

function getConnectAnnotationEndpointKeys(annotation) {
    const endpointKeys = new Set();
    getConnectAnnotationLineKeys(annotation).forEach(lineKey => {
        const lineCandidate = snapPointLineItems.get(lineKey);
        if (!lineCandidate) return;
        lineCandidate.endpointKeys.forEach(endpointKey => endpointKeys.add(endpointKey));
    });

    if (!endpointKeys.size) {
        getConnectAnnotationSegments(annotation).forEach(segment => {
            if (!Array.isArray(segment)) return;
            segment.forEach(point => {
                if (!point) return;
                endpointKeys.add(getSnapPointKey(annotation.layerName, point.x, point.y));
            });
        });
    }

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

const MANUAL_LABEL_INTERNAL_PARALLEL_MAX_ANGLE_DEGREES = 5;
const MANUAL_LABEL_INTERNAL_ELBOW_MAX_ANGLE_DEGREES = 90;

function getManualParallelMaxAngleDegrees() {
    const configuredValue = Number(CONFIG.MANUAL_LABEL_PARALLEL_MAX_ANGLE_DEGREES);
    return configuredValue > 0
        ? configuredValue
        : MANUAL_LABEL_INTERNAL_PARALLEL_MAX_ANGLE_DEGREES;
}

function getManualElbowMinAngleDegrees() {
    return getManualParallelMaxAngleDegrees();
}

function getManualElbowMaxAngleDegrees() {
    return Math.max(MANUAL_LABEL_INTERNAL_ELBOW_MAX_ANGLE_DEGREES, getManualElbowMinAngleDegrees());
}

function getManualTeeMinAngleDegrees() {
    return getManualParallelMaxAngleDegrees();
}

function getLineCandidateUndirectedAngleDegrees(lineCandidateA, lineCandidateB) {
    const directionA = getLineCandidateUnitDirection(lineCandidateA);
    const directionB = getLineCandidateUnitDirection(lineCandidateB);
    if (!directionA || !directionB) return Infinity;

    const rawDot = (directionA.x * directionB.x) + (directionA.y * directionB.y);
    const clampedDot = Math.min(1, Math.max(-1, Math.abs(rawDot)));
    return Math.acos(clampedDot) * (180 / Math.PI);
}

function areParallelLineCandidates(lineCandidateA, lineCandidateB) {
    return getLineCandidateUndirectedAngleDegrees(lineCandidateA, lineCandidateB) <= getManualParallelMaxAngleDegrees();
}

function isLineCandidateAngleInRange(referenceLineCandidate, lineCandidate, minAngleDegrees, maxAngleDegrees = 90) {
    const angleDegrees = getLineCandidateUndirectedAngleDegrees(referenceLineCandidate, lineCandidate);
    return angleDegrees >= minAngleDegrees && angleDegrees <= maxAngleDegrees;
}

function isElbowLineCandidate(referenceLineCandidate, lineCandidate) {
    return isLineCandidateAngleInRange(
        referenceLineCandidate,
        lineCandidate,
        getManualElbowMinAngleDegrees(),
        getManualElbowMaxAngleDegrees()
    );
}

function isTeeLineCandidate(referenceLineCandidate, lineCandidate) {
    return isLineCandidateAngleInRange(
        referenceLineCandidate,
        lineCandidate,
        getManualTeeMinAngleDegrees(),
        90
    );
}

function isAngledBranchLineCandidate(referenceLineCandidate, lineCandidate) {
    return isElbowLineCandidate(referenceLineCandidate, lineCandidate);
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

function isDashContinuationLineCandidate(lineCandidate, referenceLineCandidate = null, adjacentLineCandidate = null) {
    if (!lineCandidate) return false;
    if (isShortDashedLineCandidate(lineCandidate)) return true;
    if (referenceLineCandidate && doLineCandidatesShareDashGroup(referenceLineCandidate, lineCandidate)) {
        return true;
    }
    if (adjacentLineCandidate && doLineCandidatesShareDashGroup(adjacentLineCandidate, lineCandidate)) {
        return true;
    }
    return false;
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
    if (!isDashContinuationLineCandidate(lineCandidateA, referenceLineCandidate, lineCandidateB)
        || !isDashContinuationLineCandidate(lineCandidateB, referenceLineCandidate, lineCandidateA)) {
        return null;
    }
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
    if (!isDashContinuationLineCandidate(currentLineCandidate, referenceLineCandidate)) return [];

    const sharedNeighborsBySide = new Map();
    const fallbackNeighborsBySide = new Map();
    const queryRange = expandBounds(
        getLineCandidateBounds(currentLineCandidate),
        getManualSuggestionSearchPadding()
    );
    queryLayerLineCandidates(currentLineCandidate.layerName, queryRange).forEach(lineCandidate => {
        if (!lineCandidate || lineCandidate.id === currentLineCandidate.id) return;
        if (existingConnectLineKeys.has(lineCandidate.id)) return;
        const compatibility = getDashedLineCandidateCompatibility(referenceLineCandidate, currentLineCandidate, lineCandidate);
        if (!compatibility) return;

        const targetMap = compatibility.sharedDashGroup ? sharedNeighborsBySide : fallbackNeighborsBySide;
        const sideEntries = targetMap.get(compatibility.side) || [];
        sideEntries.push({ lineCandidate, compatibility });
        targetMap.set(compatibility.side, sideEntries);
    });

    function getOrderedNeighborsForSide(targetMap, side) {
        return (targetMap.get(side) || [])
            .slice()
            .sort((left, right) => {
                const scoreDelta = left.compatibility.score - right.compatibility.score;
                if (Math.abs(scoreDelta) > 1e-6) return scoreDelta;

                const gapDelta = left.compatibility.gap - right.compatibility.gap;
                if (Math.abs(gapDelta) > 1e-6) return gapDelta;

                const lengthDelta = getLineCandidateLength(left.lineCandidate) - getLineCandidateLength(right.lineCandidate);
                if (Math.abs(lengthDelta) > 1e-6) return lengthDelta;

                return String(left.lineCandidate.id).localeCompare(String(right.lineCandidate.id));
            })
            .map(entry => entry.lineCandidate);
    }

    return ['backward', 'forward']
        .flatMap(side => {
            const sharedNeighbors = getOrderedNeighborsForSide(sharedNeighborsBySide, side);
            if (sharedNeighbors.length) {
                return sharedNeighbors;
            }
            return getOrderedNeighborsForSide(fallbackNeighborsBySide, side);
        });
}

function getSameLayerLineCandidatesForEndpoint(endpointKey, layerName, options = {}) {
    if (!layerName) return [];
    const tolerance = Number.isFinite(options?.tolerance)
        ? Number(options.tolerance)
        : getManualEndpointTouchToleranceWorld();
    const mergedLineCandidates = new Map();
    const exactLineCandidates = snapPointLineCandidates.get(endpointKey);
    if (Array.isArray(exactLineCandidates)) {
        exactLineCandidates.forEach(lineCandidate => {
            if (!lineCandidate || lineCandidate.layerName !== layerName) return;
            mergedLineCandidates.set(lineCandidate.id, lineCandidate);
        });
    }

    const endpointPoint = parseSnapPointKey(endpointKey, layerName);
    if (!endpointPoint) {
        return Array.from(mergedLineCandidates.values());
    }

    getNearbySameLayerLineCandidatesForPoint(endpointPoint, layerName, tolerance, {
        includeInteriorTouch: Boolean(options?.includeInteriorTouch)
    }).forEach(lineCandidate => {
        mergedLineCandidates.set(lineCandidate.id, lineCandidate);
    });

    return Array.from(mergedLineCandidates.values());
}

function getReferenceLineCandidateForLines(lineCandidates) {
    return lineCandidates
        .slice()
        .sort((left, right) => getLineCandidateLength(right) - getLineCandidateLength(left))[0] || null;
}

function getLineCandidateDirectionFromEndpoint(lineCandidate, endpointKey) {
    if (!lineCandidate?.points || lineCandidate.points.length < 2 || !endpointKey) return null;

    const endpointIndex = [0, 1].findIndex(pointIndex => {
        const candidateEndpointKey = lineCandidate.endpointKeys?.[pointIndex]
            || getSnapPointKey(lineCandidate.layerName, lineCandidate.points[pointIndex].x, lineCandidate.points[pointIndex].y);
        return candidateEndpointKey === endpointKey;
    });
    if (endpointIndex < 0) return null;

    const otherPointIndex = endpointIndex === 0 ? 1 : 0;
    const endpointPoint = lineCandidate.points[endpointIndex];
    const otherPoint = lineCandidate.points[otherPointIndex];
    const dx = Number(otherPoint.x) - Number(endpointPoint.x);
    const dy = Number(otherPoint.y) - Number(endpointPoint.y);
    const length = Math.hypot(dx, dy);
    if (length <= 1e-6) return null;

    return {
        x: dx / length,
        y: dy / length
    };
}

function areLineCandidatesStraightContinuationAtEndpoint(referenceLineCandidate, lineCandidateA, lineCandidateB, endpointKey) {
    if (!referenceLineCandidate || !lineCandidateA || !lineCandidateB || lineCandidateA.id === lineCandidateB.id) {
        return false;
    }
    if (!areParallelLineCandidates(referenceLineCandidate, lineCandidateA)
        || !areParallelLineCandidates(referenceLineCandidate, lineCandidateB)) {
        return false;
    }

    const directionA = getLineCandidateDirectionFromEndpoint(lineCandidateA, endpointKey);
    const directionB = getLineCandidateDirectionFromEndpoint(lineCandidateB, endpointKey);
    if (!directionA || !directionB) return false;

    const oppositeDirectionDotThreshold = -Math.cos((getManualParallelMaxAngleDegrees() * Math.PI) / 180);
    const directionDot = (directionA.x * directionB.x) + (directionA.y * directionB.y);
    return directionDot <= oppositeDirectionDotThreshold;
}

function isStraightThroughEndpoint(endpointKey, layerName, referenceLineCandidate, groupedLineKeySet = null, options = {}) {
    if (!referenceLineCandidate) return false;
    const sameLayerLineCandidates = getSameLayerLineCandidatesForEndpoint(endpointKey, layerName, options);
    if (sameLayerLineCandidates.length < 2) return false;

    const eligibleLineCandidates = sameLayerLineCandidates.filter(lineCandidate => {
        if (!lineCandidate || !areParallelLineCandidates(referenceLineCandidate, lineCandidate)) {
            return false;
        }
        if (groupedLineKeySet instanceof Set) {
            return groupedLineKeySet.has(lineCandidate.id);
        }
        return true;
    });
    if (eligibleLineCandidates.length < 2) return false;

    const extraIncidentLineCount = sameLayerLineCandidates.length - eligibleLineCandidates.length;
    if (extraIncidentLineCount > 1) {
        return false;
    }

    for (let candidateIndex = 0; candidateIndex < eligibleLineCandidates.length; candidateIndex += 1) {
        for (let otherCandidateIndex = candidateIndex + 1; otherCandidateIndex < eligibleLineCandidates.length; otherCandidateIndex += 1) {
            if (areLineCandidatesStraightContinuationAtEndpoint(
                referenceLineCandidate,
                eligibleLineCandidates[candidateIndex],
                eligibleLineCandidates[otherCandidateIndex],
                endpointKey
            )) {
                return true;
            }
        }
    }

    return false;
}

function isJunctionEndpoint(endpointKey, layerName, referenceLineCandidate, options = {}) {
    if (!referenceLineCandidate) return false;
    const sameLayerLineCandidates = getSameLayerLineCandidatesForEndpoint(endpointKey, layerName, {
        ...options,
        includeInteriorTouch: true
    });
    if (sameLayerLineCandidates.length < 2) return false;
    if (sameLayerLineCandidates.length !== 2) return true;
    return sameLayerLineCandidates.some(lineCandidate => isElbowLineCandidate(referenceLineCandidate, lineCandidate));
}

function pickMergedConnectEndpointsFromLines(lineCandidates) {
    const referenceLineCandidate = getReferenceLineCandidateForLines(lineCandidates);
    const groupedLineKeySet = new Set(lineCandidates.map(lineCandidate => lineCandidate.id));
    const exposedEndpointMap = new Map();

    lineCandidates.forEach(lineCandidate => {
        lineCandidate.points.forEach((point, pointIndex) => {
            const endpointKey = lineCandidate.endpointKeys?.[pointIndex]
                || getSnapPointKey(lineCandidate.layerName, point.x, point.y);
            if (isStraightThroughEndpoint(endpointKey, lineCandidate.layerName, referenceLineCandidate, groupedLineKeySet, {
                tolerance: getManualParallelEndpointTouchToleranceWorld()
            })) {
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

function getConnectAnnotationInternalPoints(annotation) {
    return getConnectAnnotationInternalEndpointKeys(annotation)
        .map(endpointKey => parseSnapPointKey(endpointKey, annotation?.layerName || null))
        .filter(Boolean);
}

function getManualParallelEndpointTouchToleranceWorld() {
    return Math.max(Number(CONFIG.MANUAL_LABEL_PARALLEL_SUGGEST_TOUCH_TOLERANCE) || 0, 1e-4);
}

function getManualElbowEndpointTouchToleranceWorld() {
    return Math.max(Number(CONFIG.MANUAL_LABEL_ELBOW_SUGGEST_TOUCH_TOLERANCE) || 0, 1e-4);
}

function getManualEndpointTouchToleranceWorld() {
    return Math.max(
        getManualParallelEndpointTouchToleranceWorld(),
        getManualElbowEndpointTouchToleranceWorld(),
        1e-4
    );
}

function getManualTeeAttachToleranceWorld() {
    return Math.max(Number(CONFIG.MANUAL_LABEL_TEE_SUGGEST_TOUCH_TOLERANCE) || 0, 1e-4);
}

function getManualLineAttachToleranceWorld() {
    return Math.max(
        getManualEndpointTouchToleranceWorld(),
        getManualTeeAttachToleranceWorld(),
        1e-4
    );
}

function parseSnapPointKey(endpointKey, fallbackLayerName = null) {
    if (!endpointKey) return null;
    const parts = String(endpointKey).split('|');
    if (parts.length < 3) return null;

    const y = Number(parts.pop());
    const x = Number(parts.pop());
    const layerName = parts.join('|') || fallbackLayerName;
    if (!layerName || !Number.isFinite(x) || !Number.isFinite(y)) return null;

    return { x, y, layerName };
}

function isPointNearLineCandidateEndpoint(point, lineCandidate, tolerance = getManualEndpointTouchToleranceWorld()) {
    if (!point || !lineCandidate?.points || lineCandidate.points.length < 2) return false;
    return lineCandidate.points.slice(0, 2).some(candidatePoint => Math.hypot(
        Number(candidatePoint.x) - Number(point.x),
        Number(candidatePoint.y) - Number(point.y)
    ) <= tolerance);
}

function isPointNearLineCandidateIncident(point, lineCandidate, tolerance = getManualEndpointTouchToleranceWorld()) {
    if (!point || !lineCandidate?.points || lineCandidate.points.length < 2) return false;
    if (isPointNearLineCandidateEndpoint(point, lineCandidate, tolerance)) return true;
    return isPointOnSegmentInterior(point, lineCandidate.points[0], lineCandidate.points[1], tolerance);
}

function getNearbySameLayerLineCandidatesForPoint(point, layerName, tolerance = getManualEndpointTouchToleranceWorld(), options = {}) {
    if (!point || !layerName || tolerance <= 1e-6) return [];

    const queryRange = expandBounds({
        minX: Number(point.x),
        minY: Number(point.y),
        maxX: Number(point.x),
        maxY: Number(point.y)
    }, tolerance);

    return queryLayerLineCandidates(layerName, queryRange).filter(lineCandidate => {
        if (!lineCandidate || lineCandidate.layerName !== layerName) return false;
        return options?.includeInteriorTouch
            ? isPointNearLineCandidateIncident(point, lineCandidate, tolerance)
            : isPointNearLineCandidateEndpoint(point, lineCandidate, tolerance);
    });
}

function getLineLikeEndpointSearchSegments(lineLike) {
    if (!lineLike) return [];
    if (lineLike.type === 'connect') {
        return [
            ...getConnectAnnotationSegments(lineLike),
            ...getConnectAnnotationVirtualSegments(lineLike)
        ].filter(segment => Array.isArray(segment) && segment.length >= 2);
    }
    return getLineLikeProbeSegments(lineLike).filter(segment => Array.isArray(segment) && segment.length >= 2);
}

function getLineLikeEndpointSearchBounds(lineLike, tolerance = getManualLineAttachToleranceWorld()) {
    const searchSegments = getLineLikeEndpointSearchSegments(lineLike);
    const segmentPoints = searchSegments.flatMap(segment => segment);
    const boundaryPoints = Array.isArray(lineLike?.points) ? lineLike.points : [];
    const bounds = getPointsBounds([...boundaryPoints, ...segmentPoints]);
    return expandBounds(bounds, tolerance);
}

function isPointNearLineLikeForEndpointSearch(point, lineLike, tolerance = getManualLineAttachToleranceWorld()) {
    if (!point || !lineLike) return false;

    const boundaryPoints = Array.isArray(lineLike?.points) ? lineLike.points : [];
    if (boundaryPoints.some(boundaryPoint => Math.hypot(
        Number(boundaryPoint.x) - Number(point.x),
        Number(boundaryPoint.y) - Number(point.y)
    ) <= tolerance)) {
        return true;
    }

    return getLineLikeEndpointSearchSegments(lineLike).some(segment =>
        distancePointToSegment(
            Number(point.x),
            Number(point.y),
            Number(segment[0].x),
            Number(segment[0].y),
            Number(segment[1].x),
            Number(segment[1].y)
        ) <= tolerance
    );
}

function getNearbySameLayerLineCandidatesForLineLike(lineLike, layerName, tolerance = getManualLineAttachToleranceWorld()) {
    if (!lineLike || !layerName || tolerance <= 1e-6) return [];

    const queryRange = getLineLikeEndpointSearchBounds(lineLike, tolerance);
    if (!queryRange) return [];

    const mergedLineCandidates = new Map();
    queryLayerLineCandidates(layerName, queryRange).forEach(lineCandidate => {
        if (!lineCandidate || lineCandidate.layerName !== layerName) return;
        mergedLineCandidates.set(lineCandidate.id, lineCandidate);
    });

    const pointQuadtree = typeof snapPointQuadtree !== 'undefined' ? snapPointQuadtree : null;

    if (pointQuadtree) {
        const endpointMap = typeof snapPointLineCandidates !== 'undefined' && snapPointLineCandidates instanceof Map
            ? snapPointLineCandidates
            : new Map();

        Array.from(new Set(pointQuadtree.query(queryRange))).forEach(point => {
            if (!point || point.layerName !== layerName) return;
            if (!isPointNearLineLikeForEndpointSearch(point, lineLike, tolerance)) return;

            const endpointKey = point.id || getSnapPointKey(layerName, point.x, point.y);
            const exactLineCandidates = endpointMap.get(endpointKey);
            if (Array.isArray(exactLineCandidates) && exactLineCandidates.length) {
                exactLineCandidates.forEach(lineCandidate => {
                    if (!lineCandidate || lineCandidate.layerName !== layerName) return;
                    mergedLineCandidates.set(lineCandidate.id, lineCandidate);
                });
                return;
            }

            getNearbySameLayerLineCandidatesForPoint(point, layerName, tolerance).forEach(lineCandidate => {
                mergedLineCandidates.set(lineCandidate.id, lineCandidate);
            });
        });
    }

    return Array.from(mergedLineCandidates.values());
}

function doesLineCandidateTouchPoints(lineCandidate, points, tolerance = getManualEndpointTouchToleranceWorld()) {
    if (!lineCandidate || !Array.isArray(points) || !points.length) return false;
    return points.some(point => isPointNearLineCandidateEndpoint(point, lineCandidate, tolerance));
}

function getMinimumDistanceToPoints(point, points) {
    if (!point || !Array.isArray(points) || !points.length) return Infinity;
    return Math.min(...points.map(candidatePoint => Math.hypot(
        Number(candidatePoint.x) - Number(point.x),
        Number(candidatePoint.y) - Number(point.y)
    )));
}

function doesLineCandidateTouchConnectInternalEndpoints(lineCandidate, connectAnnotation, tolerance = getManualEndpointTouchToleranceWorld()) {
    if (!lineCandidate || !connectAnnotation || lineCandidate.layerName !== connectAnnotation.layerName) return false;
    const internalPoints = getConnectAnnotationInternalPoints(connectAnnotation);
    if (!internalPoints.length) return false;

    const boundaryPoints = Array.isArray(connectAnnotation?.points) ? connectAnnotation.points : [];
    return lineCandidate.points.slice(0, 2).some(point => {
        const minimumInternalDistance = getMinimumDistanceToPoints(point, internalPoints);
        if (minimumInternalDistance > tolerance) return false;

        const minimumBoundaryDistance = getMinimumDistanceToPoints(point, boundaryPoints);
        return minimumInternalDistance + 1e-6 < minimumBoundaryDistance;
    });
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

function getLineLikeProbeSegments(lineLike) {
    if (!lineLike) return [];
    if (lineLike.type === 'connect') {
        return getConnectAnnotationVirtualSegments(lineLike);
    }
    if (Array.isArray(lineLike?.points) && lineLike.points.length >= 2) {
        return [[
            cloneAnnotationPoint(lineLike.points[0]),
            cloneAnnotationPoint(lineLike.points[1])
        ]];
    }
    return [];
}

function getClosestPointsBetweenSegments(segmentAStart, segmentAEnd, segmentBStart, segmentBEnd) {
    const ux = Number(segmentAEnd.x) - Number(segmentAStart.x);
    const uy = Number(segmentAEnd.y) - Number(segmentAStart.y);
    const vx = Number(segmentBEnd.x) - Number(segmentBStart.x);
    const vy = Number(segmentBEnd.y) - Number(segmentBStart.y);
    const wx = Number(segmentAStart.x) - Number(segmentBStart.x);
    const wy = Number(segmentAStart.y) - Number(segmentBStart.y);

    const a = (ux * ux) + (uy * uy);
    const b = (ux * vx) + (uy * vy);
    const c = (vx * vx) + (vy * vy);
    const d = (ux * wx) + (uy * wy);
    const e = (vx * wx) + (vy * wy);
    const denominator = (a * c) - (b * b);
    const epsilon = 1e-9;

    let sNumerator;
    let sDenominator = denominator;
    let tNumerator;
    let tDenominator = denominator;

    if (a <= epsilon || c <= epsilon) {
        return null;
    }

    if (denominator <= epsilon) {
        sNumerator = 0;
        sDenominator = 1;
        tNumerator = e;
        tDenominator = c;
    } else {
        sNumerator = (b * e) - (c * d);
        tNumerator = (a * e) - (b * d);

        if (sNumerator < 0) {
            sNumerator = 0;
            tNumerator = e;
            tDenominator = c;
        } else if (sNumerator > sDenominator) {
            sNumerator = sDenominator;
            tNumerator = e + b;
            tDenominator = c;
        }
    }

    if (tNumerator < 0) {
        tNumerator = 0;
        if (-d < 0) {
            sNumerator = 0;
        } else if (-d > a) {
            sNumerator = sDenominator;
        } else {
            sNumerator = -d;
            sDenominator = a;
        }
    } else if (tNumerator > tDenominator) {
        tNumerator = tDenominator;
        if ((b - d) < 0) {
            sNumerator = 0;
        } else if ((b - d) > a) {
            sNumerator = sDenominator;
        } else {
            sNumerator = b - d;
            sDenominator = a;
        }
    }

    const segmentAParameter = Math.abs(sNumerator) <= epsilon ? 0 : (sNumerator / sDenominator);
    const segmentBParameter = Math.abs(tNumerator) <= epsilon ? 0 : (tNumerator / tDenominator);
    const closestPointA = {
        x: Number(segmentAStart.x) + (segmentAParameter * ux),
        y: Number(segmentAStart.y) + (segmentAParameter * uy)
    };
    const closestPointB = {
        x: Number(segmentBStart.x) + (segmentBParameter * vx),
        y: Number(segmentBStart.y) + (segmentBParameter * vy)
    };

    return {
        pointA: closestPointA,
        pointB: closestPointB,
        distance: Math.hypot(closestPointA.x - closestPointB.x, closestPointA.y - closestPointB.y),
        segmentAParameter,
        segmentBParameter,
        segmentALength: Math.sqrt(a),
        segmentBLength: Math.sqrt(c)
    };
}

function isSegmentParameterInterior(parameter, segmentLength, tolerance = getManualLineAttachToleranceWorld()) {
    if (!Number.isFinite(parameter) || !Number.isFinite(segmentLength) || segmentLength <= 1e-6) return false;
    const normalizedEdgeTolerance = Math.min(tolerance / Math.max(segmentLength, tolerance), 0.499999);
    return parameter > normalizedEdgeTolerance && parameter < 1 - normalizedEdgeTolerance;
}

function doesLineLikeCrossConnectInterior(lineLike, connectAnnotation, tolerance = getManualTeeAttachToleranceWorld()) {
    if (!lineLike || !connectAnnotation || lineLike.layerName !== connectAnnotation.layerName) return false;

    const lineLikeSegments = getLineLikeProbeSegments(lineLike);
    const connectSegments = getConnectAnnotationVirtualSegments(connectAnnotation);
    if (!lineLikeSegments.length || !connectSegments.length) return false;

    return lineLikeSegments.some(lineSegment => {
        if (!Array.isArray(lineSegment) || lineSegment.length < 2) return false;
        return connectSegments.some(connectSegment => {
            if (!Array.isArray(connectSegment) || connectSegment.length < 2) return false;
            const closestApproach = getClosestPointsBetweenSegments(
                lineSegment[0],
                lineSegment[1],
                connectSegment[0],
                connectSegment[1]
            );
            if (!closestApproach || closestApproach.distance > tolerance) return false;

            return isSegmentParameterInterior(
                closestApproach.segmentAParameter,
                closestApproach.segmentALength,
                tolerance
            ) && isSegmentParameterInterior(
                closestApproach.segmentBParameter,
                closestApproach.segmentBLength,
                tolerance
            );
        });
    });
}

function isDashedLineLikeForTeeSuggestion(lineLike) {
    if (!lineLike) return false;
    if (lineLike.type === 'connect') {
        return getConnectAnnotationResolvedLineCandidates(lineLike).some(lineCandidate => isShortDashedLineCandidate(lineCandidate));
    }
    return isShortDashedLineCandidate(lineLike);
}

function doesAnyBoundaryPointReachSegments(points, segments, tolerance) {
    if (!Array.isArray(points) || !points.length || !Array.isArray(segments) || !segments.length) {
        return false;
    }

    return points.some(point => segments.some(segment => {
        if (!Array.isArray(segment) || segment.length < 2) return false;
        return distancePointToSegment(
            Number(point.x),
            Number(point.y),
            Number(segment[0].x),
            Number(segment[0].y),
            Number(segment[1].x),
            Number(segment[1].y)
        ) <= tolerance;
    }));
}

function doesDashedLineLikeEndpointReachConnect(lineLike, connectAnnotation, tolerance = getManualTeeAttachToleranceWorld()) {
    if (!lineLike || !connectAnnotation || lineLike.layerName !== connectAnnotation.layerName) return false;

    const lineLikeBoundaryPoints = Array.isArray(lineLike?.points) ? lineLike.points : [];
    const lineLikeSegments = getLineLikeProbeSegments(lineLike);
    const connectBoundaryPoints = Array.isArray(connectAnnotation?.points) ? connectAnnotation.points : [];
    const connectSegments = getConnectAnnotationVirtualSegments(connectAnnotation);
    const dashedLineLikeNearConnect = isDashedLineLikeForTeeSuggestion(lineLike)
        && doesAnyBoundaryPointReachSegments(lineLikeBoundaryPoints, connectSegments, tolerance);

    if (dashedLineLikeNearConnect) return true;

    const dashedConnectNearLineLike = isDashedLineLikeForTeeSuggestion(connectAnnotation)
        && doesAnyBoundaryPointReachSegments(connectBoundaryPoints, lineLikeSegments, tolerance);

    return dashedConnectNearLineLike;
}

function collectExistingConnectLineKeys(annotations) {
    const lineKeys = new Set();
    (annotations || []).forEach(annotation => {
        if (annotation?.type !== 'connect') return;
        if (annotation.virtualSuggestionRoot) return;
        getConnectAnnotationLineKeys(annotation).forEach(lineKey => lineKeys.add(lineKey));
    });
    return lineKeys;
}

function getConnectAnnotationTraversalKey(annotation) {
    if (!annotation || annotation.type !== 'connect') return null;
    const groupKey = getConnectAnnotationGroupKey(annotation);
    if (groupKey) return groupKey;
    if (annotation.id !== undefined && annotation.id !== null) {
        return `id:${annotation.id}`;
    }
    const endpointKeys = getConnectAnnotationEndpointKeys(annotation);
    return endpointKeys.length ? endpointKeys.slice().sort().join('||') : null;
}

function collectUniqueConnectAnnotationsForSuggestionTraversal(annotations) {
    const uniqueAnnotations = [];
    const seenCollectionKeys = new Set();

    (annotations || []).forEach((annotation, index) => {
        if (annotation?.type !== 'connect') return;
        const collectionKey = getConnectAnnotationTraversalKey(annotation)
            || (annotation.id !== undefined && annotation.id !== null ? `id:${annotation.id}` : `index:${index}`);
        if (seenCollectionKeys.has(collectionKey)) return;
        seenCollectionKeys.add(collectionKey);
        uniqueAnnotations.push(annotation);
    });

    return uniqueAnnotations;
}

function getConnectSuggestionTraversalTouchToleranceWorld() {
    return getManualLineAttachToleranceWorld();
}

function getConnectAnnotationTraversalPoints(annotation) {
    if (!annotation || annotation.type !== 'connect') return [];

    const pointMap = new Map();
    getConnectAnnotationBoundaryPoints(annotation).forEach(point => {
        if (!point) return;
        pointMap.set(`${Number(point.x).toFixed(3)}|${Number(point.y).toFixed(3)}`, cloneAnnotationPoint(point));
    });
    getConnectAnnotationInternalPoints(annotation).forEach(point => {
        if (!point) return;
        pointMap.set(`${Number(point.x).toFixed(3)}|${Number(point.y).toFixed(3)}`, cloneAnnotationPoint(point));
    });
    return Array.from(pointMap.values());
}

function getConnectAnnotationTraversalBounds(annotation, padding = getConnectSuggestionTraversalTouchToleranceWorld()) {
    return getConnectAnnotationSearchBounds(annotation, padding);
}

function buildConnectSuggestionTraversalIndex(connectAnnotations, padding = getConnectSuggestionTraversalTouchToleranceWorld()) {
    const indexedConnectAnnotations = [];
    let bounds = null;

    (connectAnnotations || []).forEach(annotation => {
        if (annotation?.type !== 'connect') return;
        const bbox = getConnectAnnotationTraversalBounds(annotation, padding);
        if (!bbox) return;

        indexedConnectAnnotations.push({ annotation, bbox });
        bounds = bounds
            ? {
                minX: Math.min(bounds.minX, bbox.minX),
                minY: Math.min(bounds.minY, bbox.minY),
                maxX: Math.max(bounds.maxX, bbox.maxX),
                maxY: Math.max(bounds.maxY, bbox.maxY)
            }
            : { ...bbox };
    });

    if (!indexedConnectAnnotations.length || !bounds || typeof Quadtree !== 'function') {
        return {
            indexedConnectAnnotations,
            quadtree: null,
            padding
        };
    }

    const quadtree = new Quadtree({
        x: bounds.minX,
        y: bounds.minY,
        width: Math.max(bounds.maxX - bounds.minX, padding * 2, 1e-3),
        height: Math.max(bounds.maxY - bounds.minY, padding * 2, 1e-3)
    }, 25, 8);
    indexedConnectAnnotations.forEach(item => quadtree.insert(item));

    return {
        indexedConnectAnnotations,
        quadtree,
        padding
    };
}

function queryConnectedSuggestionTraversalCandidates(annotation, traversalIndex) {
    if (!annotation || annotation.type !== 'connect') return [];

    const padding = traversalIndex?.padding || getConnectSuggestionTraversalTouchToleranceWorld();
    const queryBounds = getConnectAnnotationTraversalBounds(annotation, padding);
    if (!queryBounds) return [];

    const indexedItems = traversalIndex?.quadtree
        ? Array.from(new Set(traversalIndex.quadtree.query(queryBounds)))
        : (traversalIndex?.indexedConnectAnnotations || []).filter(item => doBoundsIntersect(item?.bbox, queryBounds));

    return indexedItems
        .map(item => item?.annotation)
        .filter(candidate => candidate && candidate !== annotation);
}

function doConnectAnnotationsTouchForSuggestionTraversal(annotationA, annotationB, tolerance = getConnectSuggestionTraversalTouchToleranceWorld()) {
    if (!annotationA || !annotationB || annotationA.type !== 'connect' || annotationB.type !== 'connect') {
        return false;
    }

    const boundsA = getConnectAnnotationTraversalBounds(annotationA, 0);
    const boundsB = getConnectAnnotationTraversalBounds(annotationB, 0);
    if (boundsA && boundsB && !doBoundsIntersect(expandBounds(boundsA, tolerance), expandBounds(boundsB, tolerance))) {
        return false;
    }

    const traversalPointsA = getConnectAnnotationTraversalPoints(annotationA);
    const traversalPointsB = getConnectAnnotationTraversalPoints(annotationB);
    if (!traversalPointsA.length || !traversalPointsB.length) return false;

    return traversalPointsA.some(point => isPointNearLineLikeForEndpointSearch(point, annotationB, tolerance))
        || traversalPointsB.some(point => isPointNearLineLikeForEndpointSearch(point, annotationA, tolerance));
}

function projectConnectAnnotationToLayerForSuggestionTraversal(annotation, targetLayerName) {
    if (!annotation || annotation.type !== 'connect' || !targetLayerName) return null;

    const projectedAnnotation = cloneAnnotation(annotation);
    projectedAnnotation.layerName = targetLayerName;
    projectedAnnotation.points = (projectedAnnotation.points || []).map(point => ({
        x: Number(point.x),
        y: Number(point.y),
        layerName: targetLayerName
    }));

    if (Array.isArray(projectedAnnotation.segments) && projectedAnnotation.segments.length) {
        projectedAnnotation.segments = projectedAnnotation.segments.map(segment => (
            Array.isArray(segment)
                ? segment.map(point => ({
                    x: Number(point.x),
                    y: Number(point.y),
                    layerName: targetLayerName
                }))
                : []
        ));
    }

    if (annotation.layerName !== targetLayerName) {
        delete projectedAnnotation.lineKeys;
        projectedAnnotation.virtualSuggestionRoot = true;
        projectedAnnotation.id = `virtual-root:${targetLayerName}:${getConnectAnnotationTraversalKey(annotation) || annotation.id || 'unknown'}`;
    }

    return projectedAnnotation;
}

function collectConnectedSuggestionRootAnnotations(connectAnnotations, existingAnnotations = []) {
    const initialConnectAnnotations = collectUniqueConnectAnnotationsForSuggestionTraversal(connectAnnotations);
    if (!initialConnectAnnotations.length) return [];

    const touchTolerance = getConnectSuggestionTraversalTouchToleranceWorld();
    const traversalConnectAnnotations = collectUniqueConnectAnnotationsForSuggestionTraversal([
        ...initialConnectAnnotations,
        ...(existingAnnotations || []).filter(annotation => annotation?.type === 'connect')
    ]);
    const traversalIndex = buildConnectSuggestionTraversalIndex(traversalConnectAnnotations, touchTolerance);

    const endpointToConnectAnnotations = new Map();
    traversalConnectAnnotations
        .forEach(annotation => {
            const traversalKey = getConnectAnnotationTraversalKey(annotation);
            if (!traversalKey) return;
            getConnectAnnotationEndpointKeys(annotation).forEach(endpointKey => {
                const connectList = endpointToConnectAnnotations.get(endpointKey);
                if (connectList) {
                    connectList.push(annotation);
                } else {
                    endpointToConnectAnnotations.set(endpointKey, [annotation]);
                }
            });
        });

    const connectedRoots = [];
    const seenTraversalStates = new Set();
    const queuedAnnotations = initialConnectAnnotations.map(annotation => ({
        annotation,
        sourceLayerName: annotation.layerName
    }));

    while (queuedAnnotations.length) {
        const queuedState = queuedAnnotations.shift();
        const annotation = queuedState?.annotation;
        const sourceLayerName = queuedState?.sourceLayerName;
        const traversalKey = getConnectAnnotationTraversalKey(annotation);
        const traversalStateKey = traversalKey && sourceLayerName
            ? `${sourceLayerName}::${traversalKey}`
            : null;
        if (!traversalStateKey || seenTraversalStates.has(traversalStateKey)) continue;

        seenTraversalStates.add(traversalStateKey);

        const projectedRoot = projectConnectAnnotationToLayerForSuggestionTraversal(annotation, sourceLayerName);
        if (projectedRoot) {
            connectedRoots.push(projectedRoot);
        }

        getConnectAnnotationEndpointKeys(annotation).forEach(endpointKey => {
            const connectList = endpointToConnectAnnotations.get(endpointKey);
            if (!Array.isArray(connectList)) return;
            connectList.forEach(connectedAnnotation => {
                const connectedTraversalKey = getConnectAnnotationTraversalKey(connectedAnnotation);
                const connectedStateKey = connectedTraversalKey && sourceLayerName
                    ? `${sourceLayerName}::${connectedTraversalKey}`
                    : null;
                if (!connectedStateKey || seenTraversalStates.has(connectedStateKey)) return;
                queuedAnnotations.push({
                    annotation: connectedAnnotation,
                    sourceLayerName
                });
            });
        });

        queryConnectedSuggestionTraversalCandidates(annotation, traversalIndex).forEach(connectedAnnotation => {
            const connectedTraversalKey = getConnectAnnotationTraversalKey(connectedAnnotation);
            const connectedStateKey = connectedTraversalKey && sourceLayerName
                ? `${sourceLayerName}::${connectedTraversalKey}`
                : null;
            if (!connectedStateKey || seenTraversalStates.has(connectedStateKey)) return;
            if (!doConnectAnnotationsTouchForSuggestionTraversal(annotation, connectedAnnotation, touchTolerance)) return;
            queuedAnnotations.push({
                annotation: connectedAnnotation,
                sourceLayerName
            });
        });
    }

    return connectedRoots;
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
            if (!isStraightThroughEndpoint(nextEndpointKey, currentLineCandidate.layerName, seedLineCandidate, null, {
                tolerance: getManualParallelEndpointTouchToleranceWorld()
            })) {
                return;
            }
            const adjacentLineCandidates = getSameLayerLineCandidatesForEndpoint(nextEndpointKey, currentLineCandidate.layerName, {
                tolerance: getManualParallelEndpointTouchToleranceWorld()
            });
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

function buildGroupedConnectAnnotationFromSeedLine(seedLineCandidate, existingConnectLineKeys, options = {}) {
    if (!seedLineCandidate) return null;

    const groupedLineCandidates = collectStraightGroupedLineCandidates(seedLineCandidate, existingConnectLineKeys);
    if (!groupedLineCandidates.length) return null;

    const groupedLineKey = groupedLineCandidates.map(candidate => candidate.id).sort().join('||');
    const annotation = createConnectAnnotationFromLineCandidates(groupedLineCandidates, {
        id: options.id !== undefined ? options.id : `suggested:${groupedLineKey}`,
        source: options.source || 'suggested',
        autoManaged: Boolean(options.autoManaged)
    });

    if (!annotation) return null;
    return {
        annotation,
        groupedLineCandidates,
        groupedLineKey
    };
}

function getManualMinSuggestConnectLength() {
    return Math.max(Number(CONFIG.MANUAL_LABEL_MIN_SUGGEST_CONNECT_LENGTH) || 0, 0);
}

function getSuggestConnectLineLikeEffectiveLength(lineLike) {
    if (!lineLike) return 0;
    if (lineLike.type === 'connect') {
        return getConnectAnnotationEffectiveLength(lineLike);
    }
    return getLineCandidateLength(lineLike);
}

function isSuggestConnectLineLikeLongEnough(lineLike) {
    return getSuggestConnectLineLikeEffectiveLength(lineLike) >= getManualMinSuggestConnectLength();
}

function buildSuggestableConnectLineLikeFromSeedLine(seedLineCandidate, existingConnectLineKeys) {
    if (!seedLineCandidate) return null;
    const groupedSuggestion = buildGroupedConnectAnnotationFromSeedLine(seedLineCandidate, existingConnectLineKeys, {
        id: `suggested-probe:${seedLineCandidate.id}`,
        source: 'suggested',
        autoManaged: false
    });
    return groupedSuggestion?.annotation || seedLineCandidate;
}

function isSuggestableConnectSeedLineLongEnough(seedLineCandidate, existingConnectLineKeys, cache = null) {
    if (!seedLineCandidate) return false;
    if (cache instanceof Map && cache.has(seedLineCandidate.id)) {
        return cache.get(seedLineCandidate.id);
    }
    const isLongEnough = isSuggestConnectLineLikeLongEnough(
        buildSuggestableConnectLineLikeFromSeedLine(seedLineCandidate, existingConnectLineKeys)
    );
    if (cache instanceof Map) {
        cache.set(seedLineCandidate.id, isLongEnough);
    }
    return isLongEnough;
}

function compareConnectSuggestionPriority(leftEntry, rightEntry) {
    const leftSuggestion = leftEntry?.suggestion || null;
    const rightSuggestion = rightEntry?.suggestion || null;

    const effectiveLengthDelta = getSuggestConnectLineLikeEffectiveLength(rightSuggestion)
        - getSuggestConnectLineLikeEffectiveLength(leftSuggestion);
    if (Math.abs(effectiveLengthDelta) > 1e-6) {
        return effectiveLengthDelta;
    }

    const segmentLengthDelta = getConnectAnnotationLength(rightSuggestion)
        - getConnectAnnotationLength(leftSuggestion);
    if (Math.abs(segmentLengthDelta) > 1e-6) {
        return segmentLengthDelta;
    }

    const rightSegmentCount = getConnectAnnotationSegments(rightSuggestion).length;
    const leftSegmentCount = getConnectAnnotationSegments(leftSuggestion).length;
    if (rightSegmentCount !== leftSegmentCount) {
        return rightSegmentCount - leftSegmentCount;
    }

    return String(leftEntry?.seedId || '').localeCompare(String(rightEntry?.seedId || ''));
}

function selectConnectSuggestionsFromCandidateEntries(candidateEntries, existingConnectLineKeys) {
    const consumedLineKeys = new Set();
    const suggestionGroupKeys = new Set();
    const suggestions = [];

    (candidateEntries || [])
        .slice()
        .sort(compareConnectSuggestionPriority)
        .forEach(candidateEntry => {
            const suggestion = candidateEntry?.suggestion || null;
            if (!suggestion) return;

            const lineKeys = getConnectAnnotationLineKeys(suggestion);
            if (!lineKeys.length) return;
            if (lineKeys.some(lineKey => existingConnectLineKeys.has(lineKey) || consumedLineKeys.has(lineKey))) {
                return;
            }

            const groupKey = getConnectAnnotationGroupKey(suggestion);
            if (groupKey && suggestionGroupKeys.has(groupKey)) return;
            if (groupKey) suggestionGroupKeys.add(groupKey);

            lineKeys.forEach(groupedLineKey => {
                consumedLineKeys.add(groupedLineKey);
            });
            suggestions.push(suggestion);
        });

    return suggestions;
}

function buildConnectSuggestionsFromSeedLines(seedLineCandidates, existingConnectLineKeys) {
    const candidateEntries = [];

    seedLineCandidates.forEach(seedLineCandidate => {
        if (!seedLineCandidate || existingConnectLineKeys.has(seedLineCandidate.id)) {
            return;
        }

        const groupedSuggestion = buildGroupedConnectAnnotationFromSeedLine(seedLineCandidate, existingConnectLineKeys, {
            source: 'suggested',
            autoManaged: false
        });
        if (!groupedSuggestion) return;

        const { annotation: suggestion } = groupedSuggestion;
        if (!isSuggestConnectLineLikeLongEnough(suggestion)) return;

        candidateEntries.push({
            seedId: seedLineCandidate.id,
            suggestion
        });
    });

    return selectConnectSuggestionsFromCandidateEntries(candidateEntries, existingConnectLineKeys);
}

function buildExpandedStraightConnectSuggestionFromAnnotation(connectAnnotation, existingConnectLineKeys, options = {}) {
    if (!connectAnnotation || connectAnnotation.type !== 'connect') return null;

    const referenceLineCandidate = getReferenceLineCandidateForAnnotation(connectAnnotation);
    if (!referenceLineCandidate) return null;

    const sourceLineCandidates = getConnectAnnotationResolvedLineCandidates(connectAnnotation)
        .filter(lineCandidate =>
            lineCandidate
            && lineCandidate.layerName === connectAnnotation.layerName
            && areParallelLineCandidates(referenceLineCandidate, lineCandidate)
        );
    if (!sourceLineCandidates.length) return null;

    const mergedLineCandidates = new Map(sourceLineCandidates.map(lineCandidate => [lineCandidate.id, lineCandidate]));
    const straightSeeds = collectStraightConnectSuggestionSeeds([connectAnnotation], existingConnectLineKeys);

    straightSeeds.forEach(seedLineCandidate => {
        if (!seedLineCandidate) return;
        const groupedSuggestion = buildGroupedConnectAnnotationFromSeedLine(seedLineCandidate, existingConnectLineKeys, {
            id: `expanded-straight-probe:${connectAnnotation.id ?? 'unknown'}:${seedLineCandidate.id}`,
            source: 'suggested',
            autoManaged: false
        });
        const groupedLineCandidates = groupedSuggestion?.groupedLineCandidates || [seedLineCandidate];
        groupedLineCandidates.forEach(lineCandidate => {
            if (!lineCandidate || lineCandidate.layerName !== connectAnnotation.layerName) return;
            mergedLineCandidates.set(lineCandidate.id, lineCandidate);
        });
    });

    if (mergedLineCandidates.size <= sourceLineCandidates.length) return null;

    const combinedLineCandidates = Array.from(mergedLineCandidates.values());
    const fallbackSuggestionId = connectAnnotation.id ?? getConnectAnnotationTraversalKey(connectAnnotation) ?? 'unknown';
    const suggestion = createConnectAnnotationFromLineCandidates(combinedLineCandidates, {
        id: options.id !== undefined
            ? options.id
            : `suggested-overlay:${fallbackSuggestionId}`,
        source: options.source || 'suggested',
        autoManaged: Boolean(options.autoManaged)
    });
    if (!suggestion) return null;

    const actualLineKeys = combinedLineCandidates
        .filter(lineCandidate => snapPointLineItems.has(lineCandidate.id))
        .map(lineCandidate => String(lineCandidate.id));
    if (actualLineKeys.length) {
        suggestion.lineKeys = Array.from(new Set(actualLineKeys)).sort();
    } else {
        delete suggestion.lineKeys;
    }
    suggestion.segments = combinedLineCandidates.map(lineCandidate =>
        lineCandidate.points.slice(0, 2).map(cloneAnnotationPoint)
    );

    if (!isSuggestConnectLineLikeLongEnough(suggestion)) return null;
    if (!doesConnectAnnotationGeometricallyCover(suggestion, connectAnnotation)) return null;

    return suggestion;
}

function buildExpandedStraightConnectSuggestionsFromAnnotations(connectAnnotations, existingConnectLineKeys) {
    const suggestionsByKey = new Map();

    (connectAnnotations || []).forEach(connectAnnotation => {
        const suggestion = buildExpandedStraightConnectSuggestionFromAnnotation(connectAnnotation, existingConnectLineKeys);
        if (!suggestion) return;

        const suggestionKey = getConnectAnnotationGroupKey(suggestion)
            || getConnectAnnotationTraversalKey(suggestion)
            || suggestion.id;
        if (!suggestionKey) return;

        const existingSuggestion = suggestionsByKey.get(suggestionKey);
        if (!existingSuggestion || getConnectAnnotationEffectiveLength(suggestion) > getConnectAnnotationEffectiveLength(existingSuggestion)) {
            suggestionsByKey.set(suggestionKey, suggestion);
        }
    });

    return Array.from(suggestionsByKey.values());
}

function collectStraightConnectSuggestionSeeds(connectAnnotations, existingConnectLineKeys) {
    const seedLineCandidates = new Map();
    const suggestableSeedLengthCache = new Map();
    connectAnnotations.forEach(annotation => {
        if (!annotation || annotation.type !== 'connect') return;
        const referenceLineCandidate = getReferenceLineCandidateForAnnotation(annotation);
        Array.from(getConnectAnnotationBoundaryEndpointKeys(annotation)).forEach(endpointKey => {
            const connectedLines = getSameLayerLineCandidatesForEndpoint(endpointKey, annotation.layerName, {
                tolerance: getManualParallelEndpointTouchToleranceWorld(),
                includeInteriorTouch: true
            });
            connectedLines.forEach(lineCandidate => {
                if (!lineCandidate || existingConnectLineKeys.has(lineCandidate.id)) return;
                if (doesLineCandidateTouchConnectInternalEndpoints(lineCandidate, annotation, getManualParallelEndpointTouchToleranceWorld())) return;
                if (referenceLineCandidate && !areParallelLineCandidates(referenceLineCandidate, lineCandidate)) return;
                if (!isSuggestableConnectSeedLineLongEnough(lineCandidate, existingConnectLineKeys, suggestableSeedLengthCache)) return;
                seedLineCandidates.set(lineCandidate.id, lineCandidate);
            });
        });
    });
    return Array.from(seedLineCandidates.values());
}

function collectTeeConnectSuggestionSeeds(connectAnnotations, existingConnectLineKeys) {
    const seedLineCandidates = new Map();
    const acceptedProbeGroupKeys = new Set();
    const suggestableSeedLengthCache = new Map();

    connectAnnotations.forEach(annotation => {
        if (!annotation || annotation.type !== 'connect') return;
        const referenceLineCandidate = getReferenceLineCandidateForAnnotation(annotation);
        if (!referenceLineCandidate) return;
        const nearbyLineCandidates = queryLayerLineCandidates(
            annotation.layerName,
            getConnectAnnotationSearchBounds(annotation)
        );

        Array.from(getConnectAnnotationBoundaryEndpointKeys(annotation))
            .filter(endpointKey => isJunctionEndpoint(endpointKey, annotation.layerName, referenceLineCandidate, {
                tolerance: getManualElbowEndpointTouchToleranceWorld()
            }))
            .forEach(endpointKey => {
                const connectedLines = getSameLayerLineCandidatesForEndpoint(endpointKey, annotation.layerName, {
                    tolerance: getManualElbowEndpointTouchToleranceWorld(),
                    includeInteriorTouch: true
                });
                connectedLines.forEach(lineCandidate => {
                    if (!lineCandidate || existingConnectLineKeys.has(lineCandidate.id)) return;
                    if (doesLineCandidateTouchConnectInternalEndpoints(lineCandidate, annotation, getManualElbowEndpointTouchToleranceWorld())) return;
                    if (!isElbowLineCandidate(referenceLineCandidate, lineCandidate)) return;
                    if (!isSuggestableConnectSeedLineLongEnough(lineCandidate, existingConnectLineKeys, suggestableSeedLengthCache)) return;
                    seedLineCandidates.set(lineCandidate.id, lineCandidate);
                });
            });

        nearbyLineCandidates.forEach(lineCandidate => {
            if (!lineCandidate) return;
            if (existingConnectLineKeys.has(lineCandidate.id) || seedLineCandidates.has(lineCandidate.id)) return;
            if (!isTeeLineCandidate(referenceLineCandidate, lineCandidate)) return;

            const groupedProbe = buildGroupedConnectAnnotationFromSeedLine(lineCandidate, existingConnectLineKeys, {
                id: `tee-probe:${lineCandidate.id}`,
                source: 'suggested',
                autoManaged: false
            });
            const teeProbe = groupedProbe?.annotation || lineCandidate;
            const probeGroupKey = groupedProbe?.groupedLineKey || null;
            if (!isSuggestConnectLineLikeLongEnough(teeProbe)) return;
            if (probeGroupKey && acceptedProbeGroupKeys.has(probeGroupKey)) return;

            const touchesConnectInterior = doesLineCandidateTouchConnectInterior(teeProbe, annotation);
            const touchesLineInterior = doesConnectBoundaryTouchLineCandidateInterior(annotation, teeProbe);
            const crossesConnectInterior = doesLineLikeCrossConnectInterior(teeProbe, annotation);
            const dashedEndpointNearConnect = doesDashedLineLikeEndpointReachConnect(teeProbe, annotation);
            if (!touchesConnectInterior && !touchesLineInterior && !crossesConnectInterior && !dashedEndpointNearConnect) return;

            if (probeGroupKey) {
                acceptedProbeGroupKeys.add(probeGroupKey);
            }
            seedLineCandidates.set(lineCandidate.id, lineCandidate);
        });
    });

    return Array.from(seedLineCandidates.values());
}

async function yieldManualSuggestionWorkIfNeeded(state, processedCount, batchSize = 80) {
    if (!state || processedCount <= 0 || processedCount % batchSize !== 0) return;
    if (typeof yieldToBrowser !== 'function') return;
    if (performance.now() - state.lastYieldTime < 8) return;
    await yieldToBrowser();
    state.lastYieldTime = performance.now();
}

function shouldContinueManualSuggestionWork(options = {}) {
    return typeof options.shouldContinue !== 'function' || options.shouldContinue();
}

async function collectStraightConnectSuggestionSeedsAsync(connectAnnotations, existingConnectLineKeys, options = {}) {
    const seedLineCandidates = new Map();
    const suggestableSeedLengthCache = new Map();
    const yieldState = { lastYieldTime: performance.now() };
    let processedCount = 0;

    for (const annotation of connectAnnotations || []) {
        if (!shouldContinueManualSuggestionWork(options)) return [];
        if (!annotation || annotation.type !== 'connect') continue;
        const referenceLineCandidate = getReferenceLineCandidateForAnnotation(annotation);
        const endpointKeys = Array.from(getConnectAnnotationBoundaryEndpointKeys(annotation));
        for (const endpointKey of endpointKeys) {
            const connectedLines = getSameLayerLineCandidatesForEndpoint(endpointKey, annotation.layerName, {
                tolerance: getManualParallelEndpointTouchToleranceWorld(),
                includeInteriorTouch: true
            });
            for (const lineCandidate of connectedLines) {
                processedCount += 1;
                await yieldManualSuggestionWorkIfNeeded(yieldState, processedCount);
                if (!shouldContinueManualSuggestionWork(options)) return [];
                if (!lineCandidate || existingConnectLineKeys.has(lineCandidate.id)) continue;
                if (doesLineCandidateTouchConnectInternalEndpoints(lineCandidate, annotation, getManualParallelEndpointTouchToleranceWorld())) continue;
                if (referenceLineCandidate && !areParallelLineCandidates(referenceLineCandidate, lineCandidate)) continue;
                if (!isSuggestableConnectSeedLineLongEnough(lineCandidate, existingConnectLineKeys, suggestableSeedLengthCache)) continue;
                seedLineCandidates.set(lineCandidate.id, lineCandidate);
            }
        }
    }

    return Array.from(seedLineCandidates.values());
}

async function collectTeeConnectSuggestionSeedsAsync(connectAnnotations, existingConnectLineKeys, options = {}) {
    const seedLineCandidates = new Map();
    const acceptedProbeGroupKeys = new Set();
    const suggestableSeedLengthCache = new Map();
    const yieldState = { lastYieldTime: performance.now() };
    let processedCount = 0;

    for (const annotation of connectAnnotations || []) {
        if (!shouldContinueManualSuggestionWork(options)) return [];
        if (!annotation || annotation.type !== 'connect') continue;
        const referenceLineCandidate = getReferenceLineCandidateForAnnotation(annotation);
        if (!referenceLineCandidate) continue;
        const nearbyLineCandidates = queryLayerLineCandidates(
            annotation.layerName,
            getConnectAnnotationSearchBounds(annotation)
        );

        const endpointKeys = Array.from(getConnectAnnotationBoundaryEndpointKeys(annotation))
            .filter(endpointKey => isJunctionEndpoint(endpointKey, annotation.layerName, referenceLineCandidate, {
                tolerance: getManualElbowEndpointTouchToleranceWorld()
            }));
        for (const endpointKey of endpointKeys) {
            const connectedLines = getSameLayerLineCandidatesForEndpoint(endpointKey, annotation.layerName, {
                tolerance: getManualElbowEndpointTouchToleranceWorld(),
                includeInteriorTouch: true
            });
            for (const lineCandidate of connectedLines) {
                processedCount += 1;
                await yieldManualSuggestionWorkIfNeeded(yieldState, processedCount);
                if (!shouldContinueManualSuggestionWork(options)) return [];
                if (!lineCandidate || existingConnectLineKeys.has(lineCandidate.id)) continue;
                if (doesLineCandidateTouchConnectInternalEndpoints(lineCandidate, annotation, getManualElbowEndpointTouchToleranceWorld())) continue;
                if (!isElbowLineCandidate(referenceLineCandidate, lineCandidate)) continue;
                if (!isSuggestableConnectSeedLineLongEnough(lineCandidate, existingConnectLineKeys, suggestableSeedLengthCache)) continue;
                seedLineCandidates.set(lineCandidate.id, lineCandidate);
            }
        }

        for (const lineCandidate of nearbyLineCandidates) {
            processedCount += 1;
            await yieldManualSuggestionWorkIfNeeded(yieldState, processedCount);
            if (!shouldContinueManualSuggestionWork(options)) return [];
            if (!lineCandidate) continue;
            if (existingConnectLineKeys.has(lineCandidate.id) || seedLineCandidates.has(lineCandidate.id)) continue;
            if (!isTeeLineCandidate(referenceLineCandidate, lineCandidate)) continue;

            const groupedProbe = buildGroupedConnectAnnotationFromSeedLine(lineCandidate, existingConnectLineKeys, {
                id: `tee-probe:${lineCandidate.id}`,
                source: 'suggested',
                autoManaged: false
            });
            const teeProbe = groupedProbe?.annotation || lineCandidate;
            const probeGroupKey = groupedProbe?.groupedLineKey || null;
            if (!isSuggestConnectLineLikeLongEnough(teeProbe)) continue;
            if (probeGroupKey && acceptedProbeGroupKeys.has(probeGroupKey)) continue;

            const touchesConnectInterior = doesLineCandidateTouchConnectInterior(teeProbe, annotation);
            const touchesLineInterior = doesConnectBoundaryTouchLineCandidateInterior(annotation, teeProbe);
            const crossesConnectInterior = doesLineLikeCrossConnectInterior(teeProbe, annotation);
            const dashedEndpointNearConnect = doesDashedLineLikeEndpointReachConnect(teeProbe, annotation);
            if (!touchesConnectInterior && !touchesLineInterior && !crossesConnectInterior && !dashedEndpointNearConnect) continue;

            if (probeGroupKey) {
                acceptedProbeGroupKeys.add(probeGroupKey);
            }
            seedLineCandidates.set(lineCandidate.id, lineCandidate);
        }
    }

    return Array.from(seedLineCandidates.values());
}

async function buildConnectSuggestionsFromSeedLinesAsync(seedLineCandidates, existingConnectLineKeys, options = {}) {
    const candidateEntries = [];
    const yieldState = { lastYieldTime: performance.now() };
    let processedCount = 0;

    for (const seedLineCandidate of seedLineCandidates || []) {
        processedCount += 1;
        await yieldManualSuggestionWorkIfNeeded(yieldState, processedCount, 40);
        if (!shouldContinueManualSuggestionWork(options)) return [];
        if (!seedLineCandidate || existingConnectLineKeys.has(seedLineCandidate.id)) {
            continue;
        }

        const groupedSuggestion = buildGroupedConnectAnnotationFromSeedLine(seedLineCandidate, existingConnectLineKeys, {
            source: 'suggested',
            autoManaged: false
        });
        if (!groupedSuggestion) continue;

        const { annotation: suggestion } = groupedSuggestion;
        if (!isSuggestConnectLineLikeLongEnough(suggestion)) continue;

        candidateEntries.push({
            seedId: seedLineCandidate.id,
            suggestion
        });
    }

    return selectConnectSuggestionsFromCandidateEntries(candidateEntries, existingConnectLineKeys);
}

function getConnectAnnotationResolvedLineCandidates(annotation) {
    const lineCandidates = getConnectAnnotationLineKeys(annotation)
        .map(lineKey => snapPointLineItems.get(lineKey))
        .filter(Boolean);
    if (lineCandidates.length) {
        return lineCandidates;
    }

    return getConnectAnnotationSegments(annotation)
        .filter(segment => Array.isArray(segment) && segment.length >= 2)
        .map((segment, segmentIndex) => ({
            id: `segment:${annotation?.id ?? 'unknown'}:${segmentIndex}`,
            layerName: annotation?.layerName || segment[0]?.layerName,
            points: segment.map(cloneAnnotationPoint),
            endpointKeys: segment.map(point => getSnapPointKey(annotation?.layerName || point.layerName, point.x, point.y))
        }))
        .filter(lineCandidate => lineCandidate.layerName && lineCandidate.points.length >= 2);
}

function getLineLikeGroupKey(lineLike) {
    if (!lineLike) return null;
    if (lineLike.type === 'connect') {
        return getConnectAnnotationGroupKey(lineLike);
    }
    if (lineLike.id !== undefined && lineLike.id !== null) {
        return String(lineLike.id);
    }
    if (lineLike.layerName && Array.isArray(lineLike.points) && lineLike.points.length >= 2) {
        return createNormalizedLineKey(lineLike.layerName, lineLike.points[0], lineLike.points[1]);
    }
    return null;
}

function pushUniquePairCheckValue(list, value) {
    if (!Array.isArray(list) || value === undefined || value === null) return;
    if (!list.includes(value)) {
        list.push(value);
    }
}

function normalizePairCheckConditionRefs(conditionRefs = []) {
    const normalizedRefs = Array.isArray(conditionRefs) ? conditionRefs : [conditionRefs];
    return Array.from(new Set(
        normalizedRefs
            .flatMap(conditionRef => Array.isArray(conditionRef) ? conditionRef : [conditionRef])
            .map(conditionRef => String(conditionRef || '').trim())
            .filter(Boolean)
    ));
}

function formatPairCheckConditionRef(conditionRef) {
    if (!conditionRef) return '';
    if (conditionRef.startsWith('>#')) return conditionRef.slice(1);
    if (conditionRef.startsWith('#')) return conditionRef;
    if (conditionRef.startsWith('sym:') || conditionRef.startsWith('rule:') || conditionRef.startsWith('fn:')) {
        return `#${conditionRef}`;
    }
    return `#sym:${conditionRef}`;
}

function formatPairCheckNumber(value) {
    if (!Number.isFinite(value)) return 'Infinity';
    return Number(value.toFixed(3)).toString();
}

function createPairCheckComparisonMessage(metricLabel, actualValue, comparator, expectedValue, message) {
    const metricPrefix = metricLabel ? `${metricLabel} ` : '';
    return `${metricPrefix}${formatPairCheckNumber(actualValue)}${comparator}${formatPairCheckNumber(expectedValue)} failed: ${message}`;
}

function createPairCheckReason(message, conditionRefs = []) {
    const normalizedRefs = normalizePairCheckConditionRefs(conditionRefs);
    const prefix = normalizedRefs.map(formatPairCheckConditionRef).join(' ');
    return prefix ? `${prefix} ${message}` : message;
}

function pushUniquePairCheckReason(reasons, message, conditionRefs = []) {
    if (!Array.isArray(reasons) || !message) return;
    const reason = createPairCheckReason(message, conditionRefs);
    if (!reasons.includes(reason)) {
        reasons.push(reason);
    }
}

function pushUniquePairCheckComparisonReason(reasons, metricLabel, actualValue, comparator, expectedValue, message, conditionRefs = []) {
    pushUniquePairCheckReason(
        reasons,
        createPairCheckComparisonMessage(metricLabel, actualValue, comparator, expectedValue, message),
        conditionRefs
    );
}

function getLineCandidateEndpointPoints(lineCandidate) {
    if (!Array.isArray(lineCandidate?.points)) return [];
    return lineCandidate.points.slice(0, 2).map(cloneAnnotationPoint);
}

function getConnectAnnotationBoundaryPoints(annotation) {
    if (!Array.isArray(annotation?.points)) return [];
    return annotation.points.map(cloneAnnotationPoint);
}

function getMinimumDistanceBetweenPointSets(pointsA, pointsB) {
    if (!Array.isArray(pointsA) || !Array.isArray(pointsB) || !pointsA.length || !pointsB.length) {
        return Infinity;
    }

    let minimumDistance = Infinity;
    pointsA.forEach(pointA => {
        pointsB.forEach(pointB => {
            minimumDistance = Math.min(minimumDistance, Math.hypot(
                Number(pointA.x) - Number(pointB.x),
                Number(pointA.y) - Number(pointB.y)
            ));
        });
    });
    return minimumDistance;
}

function getMinimumBoundaryEndpointGapForLineCandidates(annotation, lineCandidates) {
    return getMinimumDistanceBetweenPointSets(
        getConnectAnnotationBoundaryPoints(annotation),
        (lineCandidates || []).flatMap(getLineCandidateEndpointPoints)
    );
}

function getMinimumInternalEndpointGapForLineCandidates(annotation, lineCandidates) {
    return getMinimumDistanceBetweenPointSets(
        getConnectAnnotationInternalPoints(annotation),
        (lineCandidates || []).flatMap(getLineCandidateEndpointPoints)
    );
}

function getMinimumAngleDegreesBetweenReferenceAndLineCandidates(referenceLineCandidate, lineCandidates) {
    if (!referenceLineCandidate || !Array.isArray(lineCandidates) || !lineCandidates.length) return Infinity;
    let minimumAngle = Infinity;
    lineCandidates.forEach(lineCandidate => {
        minimumAngle = Math.min(minimumAngle, getLineCandidateUndirectedAngleDegrees(referenceLineCandidate, lineCandidate));
    });
    return minimumAngle;
}

function getMaximumProbeEffectiveLengthFromLineCandidates(lineCandidates, existingConnectLineKeys) {
    if (!Array.isArray(lineCandidates) || !lineCandidates.length) return 0;
    let maximumLength = 0;
    lineCandidates.forEach(lineCandidate => {
        const probeInfo = getPairCheckProbeInfoFromSeedLine(lineCandidate, existingConnectLineKeys, 'pair-check-metric');
        maximumLength = Math.max(maximumLength, getSuggestConnectLineLikeEffectiveLength(probeInfo.probe));
    });
    return maximumLength;
}

function getMinimumLineLikeToConnectGap(lineLike, connectAnnotation) {
    const lineLikeSegments = getLineLikeProbeSegments(lineLike);
    const connectSegments = getConnectAnnotationVirtualSegments(connectAnnotation);
    if (!lineLikeSegments.length || !connectSegments.length) return Infinity;

    let minimumDistance = Infinity;
    lineLikeSegments.forEach(lineSegment => {
        if (!Array.isArray(lineSegment) || lineSegment.length < 2) return;
        connectSegments.forEach(connectSegment => {
            if (!Array.isArray(connectSegment) || connectSegment.length < 2) return;
            const closestApproach = getClosestPointsBetweenSegments(
                lineSegment[0],
                lineSegment[1],
                connectSegment[0],
                connectSegment[1]
            );
            if (!closestApproach) return;
            minimumDistance = Math.min(minimumDistance, closestApproach.distance);
        });
    });
    return minimumDistance;
}

function getMinimumProbeAttachGapForLineCandidates(lineCandidates, connectAnnotation, existingConnectLineKeys) {
    if (!Array.isArray(lineCandidates) || !lineCandidates.length) return Infinity;
    let minimumGap = Infinity;
    lineCandidates.forEach(lineCandidate => {
        const probeInfo = getPairCheckProbeInfoFromSeedLine(lineCandidate, existingConnectLineKeys, 'pair-check-attach');
        minimumGap = Math.min(minimumGap, getMinimumLineLikeToConnectGap(probeInfo.probe, connectAnnotation));
    });
    return minimumGap;
}

function getPairCheckProbeInfoFromSeedLine(seedLineCandidate, existingConnectLineKeys, probePrefix = 'pair-check-probe') {
    const groupedProbe = buildGroupedConnectAnnotationFromSeedLine(seedLineCandidate, existingConnectLineKeys, {
        id: `${probePrefix}:${seedLineCandidate.id}`,
        source: 'suggested',
        autoManaged: false
    });

    if (groupedProbe?.annotation) {
        return {
            probe: groupedProbe.annotation,
            groupKey: getConnectAnnotationGroupKey(groupedProbe.annotation),
            groupedLineKey: groupedProbe.groupedLineKey
        };
    }

    return {
        probe: seedLineCandidate,
        groupKey: getLineLikeGroupKey(seedLineCandidate),
        groupedLineKey: null
    };
}

function createConnectPairPathDiagnostics(path) {
    return {
        path,
        matched: false,
        reasons: [],
        seedLineIds: [],
        suggestionGroupKeys: [],
        probeGroupKeys: [],
        sourceBoundaryEndpointKeys: [],
        matchedSuggestionGroupKey: null,
        targetLineIds: []
    };
}

function evaluateStraightConnectSuggestionDirection(sourceAnnotation, targetAnnotation, existingConnectLineKeys, targetGroupKey) {
    const diagnostics = createConnectPairPathDiagnostics('straight');
    const sourceLayerName = sourceAnnotation?.layerName || null;
    const targetLayerName = targetAnnotation?.layerName || null;
    const sourceReferenceLineCandidate = getReferenceLineCandidateForAnnotation(sourceAnnotation);
    const targetReferenceLineCandidate = getReferenceLineCandidateForAnnotation(targetAnnotation);
    const targetLineCandidates = getConnectAnnotationResolvedLineCandidates(targetAnnotation);
    diagnostics.targetLineIds = targetLineCandidates.map(lineCandidate => lineCandidate.id);

    if (sourceLayerName !== targetLayerName) {
        pushUniquePairCheckReason(
            diagnostics.reasons,
            `${sourceLayerName || 'null'}!=${targetLayerName || 'null'} failed: Khác layer nên không thể gợi ý connect thẳng.`,
            ['#rule:PAIR_CHECK_SAME_LAYER_REQUIRED']
        );
        return diagnostics;
    }
    if (!sourceReferenceLineCandidate) {
        pushUniquePairCheckReason(diagnostics.reasons, 'sourceReferenceLine=null failed: Source connect không có reference line để kiểm tra straight.', ['#rule:PAIR_CHECK_REFERENCE_LINE_REQUIRED']);
        return diagnostics;
    }
    if (!targetReferenceLineCandidate) {
        pushUniquePairCheckReason(diagnostics.reasons, 'targetReferenceLine=null failed: Target connect không có reference line để kiểm tra straight.', ['#rule:PAIR_CHECK_REFERENCE_LINE_REQUIRED']);
        return diagnostics;
    }
    if (!targetGroupKey) {
        pushUniquePairCheckReason(diagnostics.reasons, 'targetGroupKey=null failed: Target connect không có group key hợp lệ.', ['#rule:PAIR_CHECK_GROUP_KEY_REQUIRED']);
        return diagnostics;
    }

    diagnostics.sourceBoundaryEndpointKeys = Array.from(getConnectAnnotationBoundaryEndpointKeys(sourceAnnotation));

    const touchingTargetLineIds = [];
    const nonInternalTouchTargetLineIds = [];
    const parallelTargetLineIds = [];
    const longEnoughTargetLineIds = [];
    const candidateSeedLineCandidates = new Map();
    const targetLineKeySet = new Set(targetLineCandidates.map(lineCandidate => lineCandidate.id));
    const straightTolerance = getManualParallelEndpointTouchToleranceWorld();
    const minimumBoundaryGap = getMinimumBoundaryEndpointGapForLineCandidates(sourceAnnotation, targetLineCandidates);
    const minimumInternalGap = getMinimumInternalEndpointGapForLineCandidates(sourceAnnotation, targetLineCandidates);
    const minimumParallelAngle = getMinimumAngleDegreesBetweenReferenceAndLineCandidates(sourceReferenceLineCandidate, targetLineCandidates);

    diagnostics.sourceBoundaryEndpointKeys.forEach(endpointKey => {
        const connectedLines = getSameLayerLineCandidatesForEndpoint(endpointKey, sourceLayerName, {
            tolerance: straightTolerance,
            includeInteriorTouch: true
        });
        connectedLines.forEach(lineCandidate => {
            if (!lineCandidate || !targetLineKeySet.has(lineCandidate.id)) return;
            pushUniquePairCheckValue(touchingTargetLineIds, lineCandidate.id);
            if (doesLineCandidateTouchConnectInternalEndpoints(lineCandidate, sourceAnnotation, straightTolerance)) {
                return;
            }

            pushUniquePairCheckValue(nonInternalTouchTargetLineIds, lineCandidate.id);
            if (!areParallelLineCandidates(sourceReferenceLineCandidate, lineCandidate)) {
                return;
            }

            pushUniquePairCheckValue(parallelTargetLineIds, lineCandidate.id);
            if (!isSuggestableConnectSeedLineLongEnough(lineCandidate, existingConnectLineKeys)) {
                return;
            }

            pushUniquePairCheckValue(longEnoughTargetLineIds, lineCandidate.id);
            candidateSeedLineCandidates.set(lineCandidate.id, lineCandidate);
        });
    });

    const straightSeeds = collectStraightConnectSuggestionSeeds([sourceAnnotation], existingConnectLineKeys);
    diagnostics.seedLineIds = straightSeeds.map(lineCandidate => lineCandidate.id);
    const straightSuggestions = buildConnectSuggestionsFromSeedLines(straightSeeds, existingConnectLineKeys);
    diagnostics.suggestionGroupKeys = straightSuggestions
        .map(getConnectAnnotationGroupKey)
        .filter(Boolean);

    const matchedSuggestion = straightSuggestions.find(suggestion => getConnectAnnotationGroupKey(suggestion) === targetGroupKey);
    if (matchedSuggestion) {
        diagnostics.matched = true;
        diagnostics.matchedSuggestionGroupKey = targetGroupKey;
        return diagnostics;
    }

    Array.from(candidateSeedLineCandidates.values()).forEach(lineCandidate => {
        const probeInfo = getPairCheckProbeInfoFromSeedLine(lineCandidate, existingConnectLineKeys, 'pair-check-straight');
        pushUniquePairCheckValue(diagnostics.probeGroupKeys, probeInfo.groupKey);
    });

    if (!touchingTargetLineIds.length) {
        pushUniquePairCheckComparisonReason(
            diagnostics.reasons,
            'minEndpointGap',
            minimumBoundaryGap,
            '>',
            straightTolerance,
            'Target không chạm boundary endpoint của source trong ngưỡng straight.',
            ['MANUAL_LABEL_PARALLEL_SUGGEST_TOUCH_TOLERANCE']
        );
    }
    if (touchingTargetLineIds.length && !nonInternalTouchTargetLineIds.length) {
        pushUniquePairCheckReason(
            diagnostics.reasons,
            `minInternalGap ${formatPairCheckNumber(minimumInternalGap)}<=${formatPairCheckNumber(straightTolerance)} failed: Target chỉ chạm internal endpoint của source nên bị loại khỏi straight seed.`,
            ['#rule:PAIR_CHECK_INTERNAL_ENDPOINT_EXCLUDED', 'MANUAL_LABEL_PARALLEL_SUGGEST_TOUCH_TOLERANCE']
        );
    }
    if (nonInternalTouchTargetLineIds.length && !parallelTargetLineIds.length) {
        pushUniquePairCheckComparisonReason(
            diagnostics.reasons,
            'angle',
            minimumParallelAngle,
            '>',
            getManualParallelMaxAngleDegrees(),
            'Target không song song với hướng source theo ngưỡng straight.',
            ['#sym:MANUAL_LABEL_PARALLEL_MAX_ANGLE_DEGREES']
        );
    }
    if (parallelTargetLineIds.length && !longEnoughTargetLineIds.length) {
        pushUniquePairCheckComparisonReason(
            diagnostics.reasons,
            'maxProbeLength',
            getMaximumProbeEffectiveLengthFromLineCandidates(targetLineCandidates, existingConnectLineKeys),
            '<',
            getManualMinSuggestConnectLength(),
            'Seed straight không đạt chiều dài tối thiểu.',
            ['MANUAL_LABEL_MIN_SUGGEST_CONNECT_LENGTH']
        );
    }
    if (longEnoughTargetLineIds.length && !diagnostics.probeGroupKeys.includes(targetGroupKey)) {
        pushUniquePairCheckReason(
            diagnostics.reasons,
            `probeGroup=${diagnostics.probeGroupKeys.join('|') || 'none'} != targetGroup=${targetGroupKey} failed: Gộp straight từ seed hiện tại không tạo đúng group line của target.`,
            ['#rule:PAIR_CHECK_GROUP_KEY_MISMATCH']
        );
    }
    if (!diagnostics.reasons.length) {
        pushUniquePairCheckReason(
            diagnostics.reasons,
            `suggestionGroup=${diagnostics.suggestionGroupKeys.join('|') || 'none'} != targetGroup=${targetGroupKey} failed: Không có straight suggestion nào trùng group key với target.`,
            ['#rule:PAIR_CHECK_NO_MATCHING_SUGGESTION_GROUP']
        );
    }

    return diagnostics;
}

function evaluateTeeConnectSuggestionDirection(sourceAnnotation, targetAnnotation, existingConnectLineKeys, targetGroupKey) {
    const diagnostics = createConnectPairPathDiagnostics('tee');
    const sourceLayerName = sourceAnnotation?.layerName || null;
    const targetLayerName = targetAnnotation?.layerName || null;
    const sourceReferenceLineCandidate = getReferenceLineCandidateForAnnotation(sourceAnnotation);
    const targetReferenceLineCandidate = getReferenceLineCandidateForAnnotation(targetAnnotation);
    const targetLineCandidates = getConnectAnnotationResolvedLineCandidates(targetAnnotation);
    diagnostics.targetLineIds = targetLineCandidates.map(lineCandidate => lineCandidate.id);

    if (sourceLayerName !== targetLayerName) {
        pushUniquePairCheckReason(
            diagnostics.reasons,
            `${sourceLayerName || 'null'}!=${targetLayerName || 'null'} failed: Khác layer nên không thể gợi ý tee/elbow.`,
            ['#rule:PAIR_CHECK_SAME_LAYER_REQUIRED']
        );
        return diagnostics;
    }
    if (!sourceReferenceLineCandidate) {
        pushUniquePairCheckReason(diagnostics.reasons, 'sourceReferenceLine=null failed: Source connect không có reference line để kiểm tra tee/elbow.', ['#rule:PAIR_CHECK_REFERENCE_LINE_REQUIRED']);
        return diagnostics;
    }
    if (!targetReferenceLineCandidate) {
        pushUniquePairCheckReason(diagnostics.reasons, 'targetReferenceLine=null failed: Target connect không có reference line để kiểm tra tee/elbow.', ['#rule:PAIR_CHECK_REFERENCE_LINE_REQUIRED']);
        return diagnostics;
    }
    if (!targetGroupKey) {
        pushUniquePairCheckReason(diagnostics.reasons, 'targetGroupKey=null failed: Target connect không có group key hợp lệ.', ['#rule:PAIR_CHECK_GROUP_KEY_REQUIRED']);
        return diagnostics;
    }

    const elbowTolerance = getManualElbowEndpointTouchToleranceWorld();
    diagnostics.sourceBoundaryEndpointKeys = Array.from(getConnectAnnotationBoundaryEndpointKeys(sourceAnnotation));
    const junctionEndpointKeys = diagnostics.sourceBoundaryEndpointKeys.filter(endpointKey => isJunctionEndpoint(
        endpointKey,
        sourceLayerName,
        sourceReferenceLineCandidate,
        { tolerance: elbowTolerance }
    ));
    const targetLineKeySet = new Set(targetLineCandidates.map(lineCandidate => lineCandidate.id));
    const elbowSeedLineIds = [];
    const angleQualifiedTargetLineIds = [];
    const interiorAttachTargetLineIds = [];
    const longEnoughProbeLineIds = [];
    const minimumBoundaryGap = getMinimumBoundaryEndpointGapForLineCandidates(sourceAnnotation, targetLineCandidates);
    const minimumAngle = getMinimumAngleDegreesBetweenReferenceAndLineCandidates(sourceReferenceLineCandidate, targetLineCandidates);

    junctionEndpointKeys.forEach(endpointKey => {
        const connectedLines = getSameLayerLineCandidatesForEndpoint(endpointKey, sourceLayerName, {
            tolerance: elbowTolerance,
            includeInteriorTouch: true
        });
        connectedLines.forEach(lineCandidate => {
            if (!lineCandidate || !targetLineKeySet.has(lineCandidate.id)) return;
            if (doesLineCandidateTouchConnectInternalEndpoints(lineCandidate, sourceAnnotation, elbowTolerance)) {
                return;
            }
            if (!isElbowLineCandidate(sourceReferenceLineCandidate, lineCandidate)) {
                return;
            }
            pushUniquePairCheckValue(elbowSeedLineIds, lineCandidate.id);

            const probeInfo = getPairCheckProbeInfoFromSeedLine(lineCandidate, existingConnectLineKeys, 'pair-check-tee-elbow');
            pushUniquePairCheckValue(diagnostics.probeGroupKeys, probeInfo.groupKey);
            if (isSuggestConnectLineLikeLongEnough(probeInfo.probe)) {
                pushUniquePairCheckValue(longEnoughProbeLineIds, lineCandidate.id);
            }
        });
    });

    targetLineCandidates.forEach(lineCandidate => {
        if (!lineCandidate) return;
        if (!isTeeLineCandidate(sourceReferenceLineCandidate, lineCandidate)) {
            return;
        }

        pushUniquePairCheckValue(angleQualifiedTargetLineIds, lineCandidate.id);
        const probeInfo = getPairCheckProbeInfoFromSeedLine(lineCandidate, existingConnectLineKeys, 'pair-check-tee');
        pushUniquePairCheckValue(diagnostics.probeGroupKeys, probeInfo.groupKey);

        if (!isSuggestConnectLineLikeLongEnough(probeInfo.probe)) {
            return;
        }

        pushUniquePairCheckValue(longEnoughProbeLineIds, lineCandidate.id);
        const touchesConnectInterior = doesLineCandidateTouchConnectInterior(probeInfo.probe, sourceAnnotation);
        const touchesLineInterior = doesConnectBoundaryTouchLineCandidateInterior(sourceAnnotation, probeInfo.probe);
        const crossesConnectInterior = doesLineLikeCrossConnectInterior(probeInfo.probe, sourceAnnotation);
        const dashedEndpointNearConnect = doesDashedLineLikeEndpointReachConnect(probeInfo.probe, sourceAnnotation);
        if (touchesConnectInterior || touchesLineInterior || crossesConnectInterior || dashedEndpointNearConnect) {
            pushUniquePairCheckValue(interiorAttachTargetLineIds, lineCandidate.id);
        }
    });

    const teeSeeds = collectTeeConnectSuggestionSeeds([sourceAnnotation], existingConnectLineKeys);
    diagnostics.seedLineIds = teeSeeds.map(lineCandidate => lineCandidate.id);
    const teeSuggestions = buildConnectSuggestionsFromSeedLines(teeSeeds, existingConnectLineKeys);
    diagnostics.suggestionGroupKeys = teeSuggestions
        .map(getConnectAnnotationGroupKey)
        .filter(Boolean);

    const matchedSuggestion = teeSuggestions.find(suggestion => getConnectAnnotationGroupKey(suggestion) === targetGroupKey);
    if (matchedSuggestion) {
        diagnostics.matched = true;
        diagnostics.matchedSuggestionGroupKey = targetGroupKey;
        return diagnostics;
    }

    if (!elbowSeedLineIds.length && !angleQualifiedTargetLineIds.length) {
        pushUniquePairCheckComparisonReason(
            diagnostics.reasons,
            'angle',
            minimumAngle,
            '<=',
            getManualParallelMaxAngleDegrees(),
            'Target vẫn còn nằm trong vùng parallel nên chưa được xem là góc tee/elbow.',
            ['#sym:MANUAL_LABEL_PARALLEL_MAX_ANGLE_DEGREES']
        );
    }
    if (!junctionEndpointKeys.length && !interiorAttachTargetLineIds.length) {
        if (minimumBoundaryGap > elbowTolerance) {
            pushUniquePairCheckComparisonReason(
                diagnostics.reasons,
                'minEndpointGap',
                minimumBoundaryGap,
                '>',
                elbowTolerance,
                'Source không có junction endpoint hợp lệ cho nhánh tee/elbow.',
                ['MANUAL_LABEL_ELBOW_SUGGEST_TOUCH_TOLERANCE', '#rule:PAIR_CHECK_JUNCTION_ENDPOINT_REQUIRED']
            );
        } else {
            pushUniquePairCheckReason(
                diagnostics.reasons,
                `junctionEndpointCount ${junctionEndpointKeys.length}<1 failed: Source không có junction endpoint hợp lệ cho nhánh tee/elbow dù khoảng cách endpoint đã nằm trong ngưỡng elbow.`,
                ['#rule:PAIR_CHECK_JUNCTION_ENDPOINT_REQUIRED']
            );
        }
    }
    if ((elbowSeedLineIds.length || angleQualifiedTargetLineIds.length) && !longEnoughProbeLineIds.length) {
        pushUniquePairCheckComparisonReason(
            diagnostics.reasons,
            'maxProbeLength',
            getMaximumProbeEffectiveLengthFromLineCandidates(targetLineCandidates, existingConnectLineKeys),
            '<',
            getManualMinSuggestConnectLength(),
            'Probe tee/elbow không đạt chiều dài tối thiểu.',
            ['MANUAL_LABEL_MIN_SUGGEST_CONNECT_LENGTH']
        );
    }
    if (longEnoughProbeLineIds.length && !interiorAttachTargetLineIds.length && !elbowSeedLineIds.length) {
        pushUniquePairCheckComparisonReason(
            diagnostics.reasons,
            'minAttachGap',
            getMinimumProbeAttachGapForLineCandidates(targetLineCandidates, sourceAnnotation, existingConnectLineKeys),
            '>',
            getManualTeeAttachToleranceWorld(),
            'Target không chạm hoặc cắt interior của source theo ngưỡng tee.',
            ['MANUAL_LABEL_TEE_SUGGEST_TOUCH_TOLERANCE']
        );
    }
    if ((interiorAttachTargetLineIds.length || elbowSeedLineIds.length) && !diagnostics.probeGroupKeys.includes(targetGroupKey)) {
        pushUniquePairCheckReason(
            diagnostics.reasons,
            `probeGroup=${diagnostics.probeGroupKeys.join('|') || 'none'} != targetGroup=${targetGroupKey} failed: Gộp tee/elbow từ seed hiện tại không tạo đúng group line của target.`,
            ['#rule:PAIR_CHECK_GROUP_KEY_MISMATCH']
        );
    }
    if (!diagnostics.reasons.length) {
        pushUniquePairCheckReason(
            diagnostics.reasons,
            `suggestionGroup=${diagnostics.suggestionGroupKeys.join('|') || 'none'} != targetGroup=${targetGroupKey} failed: Không có tee/elbow suggestion nào trùng group key với target.`,
            ['#rule:PAIR_CHECK_NO_MATCHING_SUGGESTION_GROUP']
        );
    }

    return diagnostics;
}

function evaluateConnectSuggestionDirection(sourceAnnotation, targetAnnotation) {
    const direction = {
        sourceId: sourceAnnotation?.id ?? null,
        targetId: targetAnnotation?.id ?? null,
        sourceLayerName: sourceAnnotation?.layerName ?? null,
        targetLayerName: targetAnnotation?.layerName ?? null,
        targetGroupKey: getConnectAnnotationGroupKey(targetAnnotation),
        isValid: false,
        matchedPath: null,
        straight: createConnectPairPathDiagnostics('straight'),
        tee: createConnectPairPathDiagnostics('tee')
    };

    if (sourceAnnotation?.type !== 'connect' || targetAnnotation?.type !== 'connect') {
        pushUniquePairCheckReason(direction.straight.reasons, 'sourceType!=connect hoặc targetType!=connect failed: Cả source và target phải là connect annotation.', ['#rule:PAIR_CHECK_CONNECT_ANNOTATION_REQUIRED']);
        pushUniquePairCheckReason(direction.tee.reasons, 'sourceType!=connect hoặc targetType!=connect failed: Cả source và target phải là connect annotation.', ['#rule:PAIR_CHECK_CONNECT_ANNOTATION_REQUIRED']);
        return direction;
    }

    const isolatedExistingConnectLineKeys = collectExistingConnectLineKeys([sourceAnnotation]);
    direction.straight = evaluateStraightConnectSuggestionDirection(
        sourceAnnotation,
        targetAnnotation,
        isolatedExistingConnectLineKeys,
        direction.targetGroupKey
    );
    direction.tee = evaluateTeeConnectSuggestionDirection(
        sourceAnnotation,
        targetAnnotation,
        isolatedExistingConnectLineKeys,
        direction.targetGroupKey
    );
    direction.isValid = Boolean(direction.straight.matched || direction.tee.matched);
    direction.matchedPath = direction.straight.matched ? 'straight' : (direction.tee.matched ? 'tee' : null);
    return direction;
}

function evaluateBidirectionalConnectSuggestionPair(annotationA, annotationB) {
    const forward = evaluateConnectSuggestionDirection(annotationA, annotationB);
    const backward = evaluateConnectSuggestionDirection(annotationB, annotationA);

    return {
        annotationAId: annotationA?.id ?? null,
        annotationBId: annotationB?.id ?? null,
        hasAnySuggestion: Boolean(forward.isValid || backward.isValid),
        isMutualSuggestion: Boolean(forward.isValid && backward.isValid),
        directions: [forward, backward]
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
