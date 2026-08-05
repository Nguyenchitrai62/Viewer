// Manual elbow repair tool.
// A user-drawn bbox limits the search area; short line/Bezier dash fragments
// are joined through their nearest compatible endpoints without changing the
// source page JSON. The same function can later be called with model bboxes.
let solidifyElbowBboxBusy = false;
let solidifyElbowBboxMessageTimer = null;
let solidifyElbowMergedShapeSequence = 0;

function getSolidifyElbowConfigNumber(key, fallback, options = {}) {
    const configuredValue = Number(CONFIG?.[key]);
    let value = Number.isFinite(configuredValue) ? configuredValue : fallback;
    if (Number.isFinite(options.min)) value = Math.max(options.min, value);
    if (Number.isFinite(options.max)) value = Math.min(options.max, value);
    if (options.integer) value = Math.round(value);
    return value;
}

function getSolidifyElbowSettings() {
    return {
        epsilon: getSolidifyElbowConfigNumber(
            'SOLIDIFY_STRAIGHT_DASH_EPSILON',
            1e-5,
            { min: Number.EPSILON }
        ),
        segmentMaxLength: getSolidifyElbowConfigNumber(
            'SOLIDIFY_ELBOW_BBOX_SEGMENT_MAX_LENGTH',
            100,
            { min: 0.001 }
        ),
        maxGapToLengthRatio: getSolidifyElbowConfigNumber(
            'SOLIDIFY_ELBOW_BBOX_MAX_GAP_TO_LENGTH_RATIO',
            2,
            { min: 0.01 }
        ),
        maxBridgeGap: getSolidifyElbowConfigNumber(
            'SOLIDIFY_ELBOW_BBOX_MAX_BRIDGE_GAP',
            100,
            { min: 0.001 }
        ),
        anchorSearchPadding: getSolidifyElbowConfigNumber(
            'SOLIDIFY_ELBOW_BBOX_ANCHOR_SEARCH_PADDING',
            35,
            { min: 0 }
        ),
        anchorMaxBridgeGap: getSolidifyElbowConfigNumber(
            'SOLIDIFY_ELBOW_BBOX_ANCHOR_MAX_BRIDGE_GAP',
            50,
            { min: 0.001 }
        ),
        anchorMaxTangentDeviationDegrees: getSolidifyElbowConfigNumber(
            'SOLIDIFY_ELBOW_BBOX_ANCHOR_MAX_TANGENT_DEVIATION_DEGREES',
            45,
            { min: 1, max: 89 }
        ),
        maxTangentDeviationDegrees: getSolidifyElbowConfigNumber(
            'SOLIDIFY_ELBOW_BBOX_MAX_TANGENT_DEVIATION_DEGREES',
            60,
            { min: 1, max: 89 }
        ),
        curveSampleSteps: getSolidifyElbowConfigNumber(
            'SOLIDIFY_ELBOW_BBOX_CURVE_SAMPLE_STEPS',
            16,
            { min: 4, max: 64, integer: true }
        ),
        curveMinimumTurnDegrees: getSolidifyElbowConfigNumber(
            'SOLIDIFY_ELBOW_BBOX_CURVE_MIN_TURN_DEGREES',
            8,
            { min: 0, max: 180 }
        ),
        curveSimplifyTolerance: getSolidifyElbowConfigNumber(
            'SOLIDIFY_ELBOW_BBOX_CURVE_SIMPLIFY_TOLERANCE',
            0.08,
            { min: 0 }
        ),
        buttonMessageDurationMs: getSolidifyElbowConfigNumber(
            'SOLIDIFY_ELBOW_BBOX_BUTTON_MESSAGE_DURATION_MS',
            2200,
            { min: 0, integer: true }
        )
    };
}

function isSolidifyElbowSourceShape(shape) {
    return Boolean(
        shape
        && shape.layer
        && typeof isSolidLineSourceLayer === 'function'
        && isSolidLineSourceLayer(shape.layer)
        && layerVisibility[shape.layer] !== false
        && !shape.fill
        && shape.color !== null
        && shape.color !== undefined
        && Array.isArray(shape.items)
        && shape.items.some(item => item?.[0] === 'l' || item?.[0] === 'c')
    );
}

function hasVisibleSolidifyElbowSource() {
    return Object.keys(layerIndex || {}).some(layerName => (
        isSolidLineSourceLayer(layerName)
        && layerVisibility[layerName] !== false
        && Array.isArray(layerIndex[layerName])
        && layerIndex[layerName].some(isSolidifyElbowSourceShape)
    ));
}

function updateSolidifyElbowBboxButtonState() {
    if (!btnSolidifyElbowBbox) return;
    btnSolidifyElbowBbox.disabled = Boolean(
        !isSolidifyElbowBboxMode
        && !solidifyElbowBboxBusy
        && !hasVisibleSolidifyElbowSource()
    );
    btnSolidifyElbowBbox.classList.toggle('active', isSolidifyElbowBboxMode);
    btnSolidifyElbowBbox.setAttribute('aria-pressed', isSolidifyElbowBboxMode ? 'true' : 'false');
    btnSolidifyElbowBbox.setAttribute('aria-busy', solidifyElbowBboxBusy ? 'true' : 'false');

    if (solidifyElbowBboxMessageTimer) return;
    if (solidifyElbowBboxBusy) {
        btnSolidifyElbowBbox.textContent = 'Đang nối elbow...';
        return;
    }
    btnSolidifyElbowBbox.textContent = isSolidifyElbowBboxMode
        ? 'Hủy bbox elbow'
        : '▧ BBox elbow → liền';
    btnSolidifyElbowBbox.title = isSolidifyElbowBboxMode
        ? 'Kéo bbox quanh elbow nét đứt; có thể vẽ liên tiếp nhiều bbox. Nhấn Esc để thoát.'
        : 'Vẽ bbox quanh elbow nét đứt để nối các đoạn cong thành nét liền';
}

function setSolidifyElbowBboxButtonMessage(message, durationMs = null) {
    if (!btnSolidifyElbowBbox) return;
    if (solidifyElbowBboxMessageTimer) clearTimeout(solidifyElbowBboxMessageTimer);
    btnSolidifyElbowBbox.textContent = message;
    solidifyElbowBboxMessageTimer = setTimeout(() => {
        solidifyElbowBboxMessageTimer = null;
        updateSolidifyElbowBboxButtonState();
    }, durationMs ?? getSolidifyElbowSettings().buttonMessageDurationMs);
}

function deactivateSolidifyElbowBboxMode(options = {}) {
    isSolidifyElbowBboxMode = false;
    solidifyElbowBboxStart = null;
    solidifyElbowCurrentBbox = null;
    canvasContainer?.classList?.remove('solidify-elbow-bbox-mode');
    updateSolidifyElbowBboxButtonState();
    if (options.clearModeLabel !== false && typeof updateModeLabel === 'function') {
        updateModeLabel(null);
    }
    if (typeof scheduleCrosshairOverlayDraw === 'function') {
        scheduleCrosshairOverlayDraw();
    }
}

function resetSolidifyElbowBboxState() {
    if (solidifyElbowBboxMessageTimer) {
        clearTimeout(solidifyElbowBboxMessageTimer);
        solidifyElbowBboxMessageTimer = null;
    }
    solidifyElbowBboxBusy = false;
    deactivateSolidifyElbowBboxMode();
}

function activateSolidifyElbowBboxMode() {
    if (typeof hasRenderableDocument === 'function' && !hasRenderableDocument()) {
        setSolidifyElbowBboxButtonMessage('Chưa có bản vẽ');
        return false;
    }
    if (!hasVisibleSolidifyElbowSource()) {
        setSolidifyElbowBboxButtonMessage('Không có layer nét đang bật');
        return false;
    }

    if (isDrawingBbox && typeof deactivateHotbarBboxDraw === 'function') {
        deactivateHotbarBboxDraw();
    }
    if (isVLMBboxMode && btnAIExtract) {
        btnAIExtract.click();
    }
    if (annotationMode && typeof deactivateManualLabelMode === 'function') {
        deactivateManualLabelMode();
    }

    isSolidifyElbowBboxMode = true;
    solidifyElbowBboxStart = null;
    solidifyElbowCurrentBbox = null;
    canvasContainer.classList.add('solidify-elbow-bbox-mode');
    mouseX = (canvas.width / zoom) / 2;
    mouseY = (canvas.height / zoom) / 2;
    updateSolidifyElbowBboxButtonState();
    if (typeof updateModeLabel === 'function') updateModeLabel('solidify-elbow');
    if (typeof scheduleCrosshairOverlayDraw === 'function') scheduleCrosshairOverlayDraw();
    return true;
}

function normalizeSolidifyElbowBbox(bbox) {
    const x = Number(bbox?.x);
    const y = Number(bbox?.y);
    const width = Number(bbox?.width);
    const height = Number(bbox?.height);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
        return null;
    }
    return {
        minX: Math.min(x, x + width),
        minY: Math.min(y, y + height),
        maxX: Math.max(x, x + width),
        maxY: Math.max(y, y + height)
    };
}

function isSolidifyElbowPointInsideBounds(point, bounds) {
    return Boolean(
        point
        && point[0] >= bounds.minX
        && point[0] <= bounds.maxX
        && point[1] >= bounds.minY
        && point[1] <= bounds.maxY
    );
}

function expandSolidifyElbowBounds(bounds, padding) {
    return {
        minX: bounds.minX - padding,
        minY: bounds.minY - padding,
        maxX: bounds.maxX + padding,
        maxY: bounds.maxY + padding
    };
}

function doesSolidifyElbowSegmentIntersectBounds(pointA, pointB, bounds) {
    if (isSolidifyElbowPointInsideBounds(pointA, bounds) || isSolidifyElbowPointInsideBounds(pointB, bounds)) {
        return true;
    }

    const deltaX = pointB[0] - pointA[0];
    const deltaY = pointB[1] - pointA[1];
    let minimumT = 0;
    let maximumT = 1;
    const clipValues = [
        [-deltaX, pointA[0] - bounds.minX],
        [deltaX, bounds.maxX - pointA[0]],
        [-deltaY, pointA[1] - bounds.minY],
        [deltaY, bounds.maxY - pointA[1]]
    ];

    for (const [projection, distance] of clipValues) {
        if (Math.abs(projection) <= Number.EPSILON) {
            if (distance < 0) return false;
            continue;
        }
        const ratio = distance / projection;
        if (projection < 0) minimumT = Math.max(minimumT, ratio);
        else maximumT = Math.min(maximumT, ratio);
        if (minimumT > maximumT) return false;
    }
    return true;
}

function sampleSolidifyElbowCubic(item, steps) {
    const [p0, p1, p2, p3] = item.slice(1, 5);
    if (![p0, p1, p2, p3].every(point => Array.isArray(point) && point.length >= 2)) {
        return [];
    }
    const points = [];
    for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        const mt = 1 - t;
        points.push([
            mt * mt * mt * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t * t * t * p3[0],
            mt * mt * mt * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t * t * t * p3[1]
        ]);
    }
    return points;
}

function getSolidifyElbowItemPolyline(item, settings) {
    if (item?.[0] === 'l') {
        return [item[1], item[2]].filter(point => Array.isArray(point) && point.length >= 2);
    }
    if (item?.[0] === 'c') {
        return sampleSolidifyElbowCubic(item, settings.curveSampleSteps);
    }
    return [];
}

function doesSolidifyElbowItemIntersectBounds(polyline, bounds) {
    for (let pointIndex = 1; pointIndex < polyline.length; pointIndex += 1) {
        if (doesSolidifyElbowSegmentIntersectBounds(polyline[pointIndex - 1], polyline[pointIndex], bounds)) {
            return true;
        }
    }
    return false;
}

function getSolidifyElbowPolylineLength(polyline) {
    let length = 0;
    for (let pointIndex = 1; pointIndex < polyline.length; pointIndex += 1) {
        length += Math.hypot(
            polyline[pointIndex][0] - polyline[pointIndex - 1][0],
            polyline[pointIndex][1] - polyline[pointIndex - 1][1]
        );
    }
    return length;
}

function normalizeSolidifyElbowDirection(vector, epsilon) {
    const length = Math.hypot(vector[0], vector[1]);
    if (!Number.isFinite(length) || length <= epsilon) return null;
    return [vector[0] / length, vector[1] / length];
}

function getSolidifyElbowEndpointDirection(polyline, fromStart, epsilon) {
    if (!Array.isArray(polyline) || polyline.length < 2) return null;
    if (fromStart) {
        const startPoint = polyline[0];
        for (let index = 1; index < polyline.length; index += 1) {
            const direction = normalizeSolidifyElbowDirection([
                polyline[index][0] - startPoint[0],
                polyline[index][1] - startPoint[1]
            ], epsilon);
            if (direction) return [-direction[0], -direction[1]];
        }
        return null;
    }

    const endPoint = polyline[polyline.length - 1];
    for (let index = polyline.length - 2; index >= 0; index -= 1) {
        const direction = normalizeSolidifyElbowDirection([
            endPoint[0] - polyline[index][0],
            endPoint[1] - polyline[index][1]
        ], epsilon);
        if (direction) return direction;
    }
    return null;
}

function getSolidifyElbowSeqnoGroupIds(shape) {
    const seqno = Number(shape?.seqno);
    if (!Number.isFinite(seqno) || !seqnoGroups || typeof seqnoGroups !== 'object') return [];
    const groupId = seqnoGroups[seqno];
    return groupId === null || groupId === undefined ? [] : [groupId];
}

function buildSolidifyElbowItemRuns(shape, settings) {
    const runs = [];
    let currentRun = null;
    const minimumAlignment = Math.cos(settings.maxTangentDeviationDegrees * Math.PI / 180);

    shape.items.forEach((item, itemIndex) => {
        if (item?.[0] !== 'l' && item?.[0] !== 'c') {
            currentRun = null;
            return;
        }
        const polyline = getSolidifyElbowItemPolyline(item, settings);
        const length = getSolidifyElbowPolylineLength(polyline);
        if (polyline.length < 2 || length <= settings.epsilon) {
            currentRun = null;
            return;
        }

        let continuesCurrentRun = false;
        if (currentRun) {
            const previousEnd = currentRun.polyline[currentRun.polyline.length - 1];
            const nextStart = polyline[0];
            const endpointGap = Math.hypot(
                nextStart[0] - previousEnd[0],
                nextStart[1] - previousEnd[1]
            );
            const previousOutward = getSolidifyElbowEndpointDirection(
                currentRun.polyline,
                false,
                settings.epsilon
            );
            const nextOutward = getSolidifyElbowEndpointDirection(polyline, true, settings.epsilon);
            const tangentAlignment = previousOutward && nextOutward
                ? -(previousOutward[0] * nextOutward[0] + previousOutward[1] * nextOutward[1])
                : -1;
            continuesCurrentRun = endpointGap <= settings.epsilon
                && tangentAlignment >= minimumAlignment;
        }

        if (!continuesCurrentRun) {
            currentRun = {
                items: [],
                itemIndexes: [],
                polyline: [],
                length: 0
            };
            runs.push(currentRun);
        }
        currentRun.items.push(item);
        currentRun.itemIndexes.push(itemIndex);
        currentRun.length += length;
        currentRun.polyline.push(...(currentRun.polyline.length ? polyline.slice(1) : polyline));
    });
    return runs;
}

function collectSolidifyElbowCandidates(bounds, settings) {
    const nearbyShapes = [];
    const anchorBounds = expandSolidifyElbowBounds(bounds, settings.anchorSearchPadding);
    if (shapeQuadtree && typeof shapeQuadtree.query === 'function') {
        shapeQuadtree.query(anchorBounds, nearbyShapes);
    } else {
        Object.values(layerIndex || {}).forEach(shapes => {
            if (Array.isArray(shapes)) nearbyShapes.push(...shapes);
        });
    }

    const uniqueShapes = Array.from(new Set(nearbyShapes));
    const candidates = [];
    uniqueShapes.forEach(shape => {
        if (!isSolidifyElbowSourceShape(shape)) return;
        const styleKey = typeof getSolidLineShapeStyleKey === 'function'
            ? getSolidLineShapeStyleKey(shape)
            : JSON.stringify([shape.color, shape.width, shape.lineCap, shape.lineJoin]);
        const seqnoGroupIds = getSolidifyElbowSeqnoGroupIds(shape);

        if (shape._isSolidifyElbowMerged && Array.isArray(shape._solidifyElbowOpenEndpoints)) {
            const endpoints = shape._solidifyElbowOpenEndpoints
                .map((endpoint, endpointIndex) => ({
                    side: endpointIndex === 0 ? 'start' : 'end',
                    point: Array.isArray(endpoint?.point) ? [...endpoint.point] : null,
                    outward: Array.isArray(endpoint?.outward) ? [...endpoint.outward] : null,
                    selectable: isSolidifyElbowPointInsideBounds(endpoint?.point, anchorBounds)
                }))
                .filter(endpoint => endpoint.point && endpoint.outward);
            if (endpoints.length >= 2 && endpoints.some(endpoint => endpoint.selectable)) {
                const pathLength = Number(shape._solidifyElbowPathLength);
                const length = Number.isFinite(pathLength) && pathLength > settings.epsilon
                    ? pathLength
                    : settings.segmentMaxLength;
                candidates.push({
                    id: candidates.length,
                    layerName: shape.layer,
                    shape,
                    items: shape.items,
                    itemIndex: null,
                    consumeWholeShape: true,
                    length,
                    matchLength: Math.min(length, settings.segmentMaxLength),
                    isAnchor: true,
                    styleKey,
                    seqnoGroupIds,
                    endpoints
                });
            }
            return;
        }

        buildSolidifyElbowItemRuns(shape, settings).forEach(run => {
            const polyline = run.polyline;
            const intersectsSelection = doesSolidifyElbowItemIntersectBounds(polyline, bounds);
            const length = run.length;
            const isShortFragment = length <= settings.segmentMaxLength;
            if (isShortFragment && !intersectsSelection) return;
            const startInsideAnchorBounds = isSolidifyElbowPointInsideBounds(polyline[0], anchorBounds);
            const endInsideAnchorBounds = isSolidifyElbowPointInsideBounds(polyline[polyline.length - 1], anchorBounds);
            // A long solid pipe/curve is still useful as an endpoint anchor.
            // This closes the final gap between a repaired elbow and the long
            // horizontal/vertical run without treating the whole run as a dash.
            if (!isShortFragment && !startInsideAnchorBounds && !endInsideAnchorBounds) return;
            const startOutward = getSolidifyElbowEndpointDirection(polyline, true, settings.epsilon);
            const endOutward = getSolidifyElbowEndpointDirection(polyline, false, settings.epsilon);
            if (!startOutward || !endOutward) return;

            candidates.push({
                id: candidates.length,
                layerName: shape.layer,
                shape,
                item: run.items[0],
                items: run.items,
                itemIndex: run.itemIndexes[0],
                itemIndexes: run.itemIndexes,
                polyline: run.polyline,
                consumeWholeShape: false,
                length,
                matchLength: Math.min(length, settings.segmentMaxLength),
                isAnchor: !isShortFragment,
                styleKey,
                seqnoGroupIds,
                endpoints: [
                    {
                        side: 'start',
                        point: [...polyline[0]],
                        outward: startOutward,
                        selectable: isShortFragment || startInsideAnchorBounds
                    },
                    {
                        side: 'end',
                        point: [...polyline[polyline.length - 1]],
                        outward: endOutward,
                        selectable: isShortFragment || endInsideAnchorBounds
                    }
                ]
            });
        });
    });
    return candidates;
}

function doSolidifyElbowCandidatesShareSeqnoGroup(candidateA, candidateB) {
    if (!candidateA.seqnoGroupIds.length || !candidateB.seqnoGroupIds.length) return false;
    const groupsA = new Set(candidateA.seqnoGroupIds);
    return candidateB.seqnoGroupIds.some(groupId => groupsA.has(groupId));
}

function getSolidifyElbowEndpointCompatibility(candidateA, endpointA, candidateB, endpointB, settings) {
    if (candidateA.layerName !== candidateB.layerName || candidateA.styleKey !== candidateB.styleKey) {
        return null;
    }
    if (!endpointA.selectable || !endpointB.selectable) return null;
    const bridge = [
        endpointB.point[0] - endpointA.point[0],
        endpointB.point[1] - endpointA.point[1]
    ];
    const gap = Math.hypot(bridge[0], bridge[1]);
    if (!Number.isFinite(gap)) return null;
    const usesAnchor = candidateA.isAnchor || candidateB.isAnchor;
    const maximumTangentDeviation = usesAnchor
        ? settings.anchorMaxTangentDeviationDegrees
        : settings.maxTangentDeviationDegrees;
    const minimumAlignment = Math.cos(maximumTangentDeviation * Math.PI / 180);

    // PDF paths frequently split one visible dash into several items. Adjacent
    // items then share the exact same endpoint, so there is no bridge vector
    // from which to derive a direction. Keep those items in the same chain when
    // their outward tangents face each other. This also resolves a T-junction
    // safely: the smooth continuation wins while the perpendicular branch is
    // left untouched.
    if (gap <= settings.epsilon) {
        const tangentAlignment = -(
            endpointA.outward[0] * endpointB.outward[0]
            + endpointA.outward[1] * endpointB.outward[1]
        );
        if (tangentAlignment < minimumAlignment) return null;
        const sharedSeqnoGroup = doSolidifyElbowCandidatesShareSeqnoGroup(candidateA, candidateB);
        const angularScale = Math.max(candidateA.matchLength, candidateB.matchLength, 1);
        return {
            candidateA,
            candidateB,
            endpointA,
            endpointB,
            gap: 0,
            isCoincident: true,
            sharedSeqnoGroup,
            score: (1 - tangentAlignment) * angularScale
                - (sharedSeqnoGroup ? angularScale * 0.25 : 0)
        };
    }

    const maximumGap = Math.min(
        Math.max(candidateA.matchLength, candidateB.matchLength) * settings.maxGapToLengthRatio,
        settings.maxBridgeGap,
        usesAnchor ? settings.anchorMaxBridgeGap : Infinity
    );
    if (gap > maximumGap + settings.epsilon) return null;

    const bridgeDirection = [bridge[0] / gap, bridge[1] / gap];
    const alignmentA = endpointA.outward[0] * bridgeDirection[0]
        + endpointA.outward[1] * bridgeDirection[1];
    const alignmentB = endpointB.outward[0] * (-bridgeDirection[0])
        + endpointB.outward[1] * (-bridgeDirection[1]);
    if (alignmentA < minimumAlignment || alignmentB < minimumAlignment) return null;

    const sharedSeqnoGroup = doSolidifyElbowCandidatesShareSeqnoGroup(candidateA, candidateB);
    return {
        candidateA,
        candidateB,
        endpointA,
        endpointB,
        gap,
        sharedSeqnoGroup,
        score: gap
            + ((1 - alignmentA) + (1 - alignmentB)) * maximumGap
            - (sharedSeqnoGroup ? maximumGap * 0.25 : 0)
    };
}

function buildSolidifyElbowEdges(candidates, settings) {
    const edges = [];
    for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
        const candidateA = candidates[leftIndex];
        for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
            const candidateB = candidates[rightIndex];
            if (candidateA.layerName !== candidateB.layerName || candidateA.styleKey !== candidateB.styleKey) {
                continue;
            }
            candidateA.endpoints.forEach(endpointA => {
                candidateB.endpoints.forEach(endpointB => {
                    const edge = getSolidifyElbowEndpointCompatibility(
                        candidateA,
                        endpointA,
                        candidateB,
                        endpointB,
                        settings
                    );
                    if (edge) edges.push(edge);
                });
            });
        }
    }
    return edges.sort((left, right) => {
        if (left.sharedSeqnoGroup !== right.sharedSeqnoGroup) {
            return left.sharedSeqnoGroup ? -1 : 1;
        }
        const scoreDifference = left.score - right.score;
        if (Math.abs(scoreDifference) > settings.epsilon) return scoreDifference;
        return left.gap - right.gap;
    });
}

function selectSolidifyElbowChainEdges(candidates, edges) {
    const usedEndpoints = new Set();
    const selectedEdges = [];

    edges.forEach(edge => {
        const endpointKeyA = `${edge.candidateA.id}:${edge.endpointA.side}`;
        const endpointKeyB = `${edge.candidateB.id}:${edge.endpointB.side}`;
        if (usedEndpoints.has(endpointKeyA) || usedEndpoints.has(endpointKeyB)) return;
        // Duct elbows can form a legitimate closed outline together with seam
        // bars. Rejecting cycle-closing edges leaves one visible dash gap in
        // every such outline. Endpoint uniqueness plus tangent compatibility
        // already prevents branches and perpendicular cross-connections.
        usedEndpoints.add(endpointKeyA);
        usedEndpoints.add(endpointKeyB);
        selectedEdges.push(edge);
    });
    return selectedEdges;
}

function buildSolidifyElbowGroups(candidates, selectedEdges) {
    const candidateIdsWithEdges = new Set();
    const adjacency = new Map();
    selectedEdges.forEach(edge => {
        candidateIdsWithEdges.add(edge.candidateA.id);
        candidateIdsWithEdges.add(edge.candidateB.id);
        const edgesA = adjacency.get(edge.candidateA.id) || [];
        const edgesB = adjacency.get(edge.candidateB.id) || [];
        edgesA.push(edge);
        edgesB.push(edge);
        adjacency.set(edge.candidateA.id, edgesA);
        adjacency.set(edge.candidateB.id, edgesB);
    });

    const candidateById = new Map(candidates.map(candidate => [candidate.id, candidate]));
    const visited = new Set();
    const groups = [];
    candidateIdsWithEdges.forEach(seedId => {
        if (visited.has(seedId)) return;
        const queue = [seedId];
        const groupCandidateIds = new Set();
        const groupEdges = new Set();
        while (queue.length) {
            const candidateId = queue.shift();
            if (visited.has(candidateId)) continue;
            visited.add(candidateId);
            groupCandidateIds.add(candidateId);
            (adjacency.get(candidateId) || []).forEach(edge => {
                groupEdges.add(edge);
                const otherId = edge.candidateA.id === candidateId
                    ? edge.candidateB.id
                    : edge.candidateA.id;
                if (!visited.has(otherId)) queue.push(otherId);
            });
        }
        if (groupCandidateIds.size >= 2 && groupEdges.size >= 1) {
            groups.push({
                candidates: Array.from(groupCandidateIds).map(candidateId => candidateById.get(candidateId)),
                edges: Array.from(groupEdges)
            });
        }
    });
    return groups;
}

function createSolidifyElbowBridgeItem(edge) {
    const controlDistance = edge.gap / 3;
    return [
        'c',
        [...edge.endpointA.point],
        [
            edge.endpointA.point[0] + edge.endpointA.outward[0] * controlDistance,
            edge.endpointA.point[1] + edge.endpointA.outward[1] * controlDistance
        ],
        [
            edge.endpointB.point[0] + edge.endpointB.outward[0] * controlDistance,
            edge.endpointB.point[1] + edge.endpointB.outward[1] * controlDistance
        ],
        [...edge.endpointB.point]
    ];
}

function getSolidifyElbowOrderedPolyline(group, settings) {
    const adjacency = new Map(group.candidates.map(candidate => [candidate.id, []]));
    group.edges.forEach(edge => {
        adjacency.get(edge.candidateA.id)?.push({
            edge,
            endpoint: edge.endpointA,
            otherCandidate: edge.candidateB,
            otherEndpoint: edge.endpointB
        });
        adjacency.get(edge.candidateB.id)?.push({
            edge,
            endpoint: edge.endpointB,
            otherCandidate: edge.candidateA,
            otherEndpoint: edge.endpointA
        });
    });
    if (Array.from(adjacency.values()).some(links => links.length > 2)) return null;

    const startCandidate = group.candidates.find(candidate => adjacency.get(candidate.id)?.length === 1);
    // Closed cycles do not have a stable start/end tangent for a single elbow
    // spline. Keep their original items and bridges.
    if (!startCandidate) return null;
    const startLink = adjacency.get(startCandidate.id)[0];
    let entrySide = startLink.endpoint.side === 'start' ? 'end' : 'start';
    let currentCandidate = startCandidate;
    let incomingEdge = null;
    const visited = new Set();
    const orderedPoints = [];

    while (currentCandidate && !visited.has(currentCandidate.id)) {
        const sourcePolyline = currentCandidate.polyline;
        if (!Array.isArray(sourcePolyline) || sourcePolyline.length < 2) return null;
        visited.add(currentCandidate.id);
        const orientedPolyline = entrySide === 'start'
            ? sourcePolyline
            : sourcePolyline.slice().reverse();
        orientedPolyline.forEach(point => {
            const previousPoint = orderedPoints[orderedPoints.length - 1];
            if (!previousPoint || Math.hypot(
                point[0] - previousPoint[0],
                point[1] - previousPoint[1]
            ) > settings.epsilon) {
                orderedPoints.push([...point]);
            }
        });

        const exitSide = entrySide === 'start' ? 'end' : 'start';
        const nextLink = (adjacency.get(currentCandidate.id) || []).find(link => (
            link.edge !== incomingEdge && link.endpoint.side === exitSide
        ));
        if (!nextLink) break;
        incomingEdge = nextLink.edge;
        currentCandidate = nextLink.otherCandidate;
        entrySide = nextLink.otherEndpoint.side;
    }

    return visited.size === group.candidates.length ? orderedPoints : null;
}

function getSolidifyElbowPointToSegmentDistance(point, segmentStart, segmentEnd) {
    const deltaX = segmentEnd[0] - segmentStart[0];
    const deltaY = segmentEnd[1] - segmentStart[1];
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    if (lengthSquared <= Number.EPSILON) {
        return Math.hypot(point[0] - segmentStart[0], point[1] - segmentStart[1]);
    }
    const projection = Math.max(0, Math.min(1, (
        (point[0] - segmentStart[0]) * deltaX
        + (point[1] - segmentStart[1]) * deltaY
    ) / lengthSquared));
    return Math.hypot(
        point[0] - (segmentStart[0] + projection * deltaX),
        point[1] - (segmentStart[1] + projection * deltaY)
    );
}

function simplifySolidifyElbowPolyline(points, tolerance) {
    if (!Array.isArray(points) || points.length <= 2 || tolerance <= 0) return points;
    let furthestIndex = -1;
    let furthestDistance = tolerance;
    for (let index = 1; index < points.length - 1; index += 1) {
        const distance = getSolidifyElbowPointToSegmentDistance(
            points[index],
            points[0],
            points[points.length - 1]
        );
        if (distance > furthestDistance) {
            furthestDistance = distance;
            furthestIndex = index;
        }
    }
    if (furthestIndex < 0) return [points[0], points[points.length - 1]];
    const left = simplifySolidifyElbowPolyline(points.slice(0, furthestIndex + 1), tolerance);
    const right = simplifySolidifyElbowPolyline(points.slice(furthestIndex), tolerance);
    return [...left.slice(0, -1), ...right];
}

function getSolidifyElbowPolylineTurnDegrees(points, epsilon) {
    let totalTurn = 0;
    for (let index = 1; index < points.length - 1; index += 1) {
        const incoming = normalizeSolidifyElbowDirection([
            points[index][0] - points[index - 1][0],
            points[index][1] - points[index - 1][1]
        ], epsilon);
        const outgoing = normalizeSolidifyElbowDirection([
            points[index + 1][0] - points[index][0],
            points[index + 1][1] - points[index][1]
        ], epsilon);
        if (!incoming || !outgoing) continue;
        const dotProduct = Math.max(-1, Math.min(1,
            incoming[0] * outgoing[0] + incoming[1] * outgoing[1]
        ));
        totalTurn += Math.acos(dotProduct) * 180 / Math.PI;
    }
    return totalTurn;
}

function getSolidifyElbowSplineTangent(points, index, epsilon) {
    if (index <= 0) {
        return normalizeSolidifyElbowDirection([
            points[1][0] - points[0][0],
            points[1][1] - points[0][1]
        ], epsilon);
    }
    if (index >= points.length - 1) {
        return normalizeSolidifyElbowDirection([
            points[index][0] - points[index - 1][0],
            points[index][1] - points[index - 1][1]
        ], epsilon);
    }
    const incoming = normalizeSolidifyElbowDirection([
        points[index][0] - points[index - 1][0],
        points[index][1] - points[index - 1][1]
    ], epsilon);
    const outgoing = normalizeSolidifyElbowDirection([
        points[index + 1][0] - points[index][0],
        points[index + 1][1] - points[index][1]
    ], epsilon);
    if (!incoming) return outgoing;
    if (!outgoing) return incoming;
    return normalizeSolidifyElbowDirection([
        incoming[0] + outgoing[0],
        incoming[1] + outgoing[1]
    ], epsilon) || outgoing;
}

function createSolidifyElbowCurveItems(group, settings) {
    const orderedPoints = getSolidifyElbowOrderedPolyline(group, settings);
    if (!orderedPoints || orderedPoints.length < 3) return null;
    if (getSolidifyElbowPolylineTurnDegrees(orderedPoints, settings.epsilon)
        < settings.curveMinimumTurnDegrees) {
        return null;
    }
    const points = simplifySolidifyElbowPolyline(
        orderedPoints,
        settings.curveSimplifyTolerance
    );
    if (points.length < 3) return null;
    const tangents = points.map((point, index) => (
        getSolidifyElbowSplineTangent(points, index, settings.epsilon)
    ));
    if (tangents.some(tangent => !tangent)) return null;

    const curveItems = [];
    for (let index = 0; index < points.length - 1; index += 1) {
        const startPoint = points[index];
        const endPoint = points[index + 1];
        const chordLength = Math.hypot(
            endPoint[0] - startPoint[0],
            endPoint[1] - startPoint[1]
        );
        if (chordLength <= settings.epsilon) continue;
        const controlDistance = chordLength / 3;
        curveItems.push([
            'c',
            [...startPoint],
            [
                startPoint[0] + tangents[index][0] * controlDistance,
                startPoint[1] + tangents[index][1] * controlDistance
            ],
            [
                endPoint[0] - tangents[index + 1][0] * controlDistance,
                endPoint[1] - tangents[index + 1][1] * controlDistance
            ],
            [...endPoint]
        ]);
    }
    return curveItems.length ? curveItems : null;
}

function createSolidifyElbowMergedShape(group, settings) {
    const sourceShape = group.candidates[0].shape;
    const sequenceNumbers = group.candidates
        .map(candidate => Number(candidate.shape.seqno))
        .filter(Number.isFinite);
    const curveItems = createSolidifyElbowCurveItems(group, settings);
    const mergedShape = {
        ...sourceShape,
        id: `solidify-elbow-bbox-${Date.now()}-${++solidifyElbowMergedShapeSequence}`,
        type: 's',
        layer: sourceShape.layer,
        items: curveItems || [
            ...group.candidates.flatMap(candidate => candidate.items),
            ...group.edges.flatMap(edge => (
                edge.isCoincident ? [] : [createSolidifyElbowBridgeItem(edge)]
            ))
        ],
        closePath: false,
        fill: null,
        rect: null,
        bbox: null,
        dashes: '[] 0',
        seqno: sequenceNumbers.length ? Math.min(...sequenceNumbers) : 0,
        // Each item is stroked as a separate subpath by the viewer. Rounded
        // caps overlap at shared endpoints and avoid one-pixel antialias seams.
        _strokeLineCap: 'round',
        _strokeLineJoin: 'round',
        _isSolidifyElbowMerged: true,
        _solidifyElbowSourceCount: group.candidates.length,
        _solidifyElbowBridgeCount: group.edges.filter(edge => !edge.isCoincident).length,
        _solidifyElbowCurveCommandCount: curveItems?.length || 0,
        _solidifyElbowPathLength: group.candidates.reduce(
            (total, candidate) => total + candidate.length,
            group.edges.reduce((total, edge) => total + edge.gap, 0)
        ),
        _solidifyElbowOpenEndpoints: (() => {
            const usedEndpoints = new Set();
            group.edges.forEach(edge => {
                usedEndpoints.add(edge.endpointA);
                usedEndpoints.add(edge.endpointB);
            });
            return group.candidates
                .flatMap(candidate => candidate.endpoints)
                .filter(endpoint => !usedEndpoints.has(endpoint))
                .map(endpoint => ({
                    point: [...endpoint.point],
                    outward: [...endpoint.outward]
                }));
        })()
    };
    prepareShapeForDraw(mergedShape, sourceShape._renderLayerPriority ?? 1, false);
    return mergedShape;
}

function cloneSolidifyElbowRemainderShape(shape, items) {
    const remainderShape = {
        ...shape,
        id: `${shape.id ?? shape.seqno ?? 'shape'}-elbow-remainder-${++solidifyElbowMergedShapeSequence}`,
        items,
        closePath: false,
        rect: null,
        bbox: null
    };
    prepareShapeForDraw(
        remainderShape,
        shape._renderLayerPriority ?? 1,
        Boolean(shape._isPipelineLayer)
    );
    return remainderShape;
}

function buildSolidifyElbowLayerReplacements(groups, settings) {
    const groupsByLayer = new Map();
    groups.forEach(group => {
        const layerName = group.candidates[0].layerName;
        const layerGroups = groupsByLayer.get(layerName) || [];
        layerGroups.push(group);
        groupsByLayer.set(layerName, layerGroups);
    });

    const replacements = new Map();
    groupsByLayer.forEach((layerGroups, layerName) => {
        const sourceShapes = layerIndex[layerName];
        if (!Array.isArray(sourceShapes) || !sourceShapes.length) return;
        const consumedItemsByShape = new Map();
        layerGroups.forEach(group => {
            group.candidates.forEach(candidate => {
                if (candidate.consumeWholeShape) {
                    consumedItemsByShape.set(candidate.shape, 'all');
                    return;
                }
                if (consumedItemsByShape.get(candidate.shape) === 'all') return;
                const itemIndexes = consumedItemsByShape.get(candidate.shape) || new Set();
                (candidate.itemIndexes || [candidate.itemIndex]).forEach(itemIndex => {
                    itemIndexes.add(itemIndex);
                });
                consumedItemsByShape.set(candidate.shape, itemIndexes);
            });
        });

        const replacementShapes = [];
        sourceShapes.forEach(shape => {
            const consumedItemIndexes = consumedItemsByShape.get(shape);
            if (!consumedItemIndexes) {
                replacementShapes.push(shape);
                return;
            }
            if (consumedItemIndexes === 'all') return;
            const remainingItems = shape.items.filter((item, itemIndex) => !consumedItemIndexes.has(itemIndex));
            if (remainingItems.length) {
                replacementShapes.push(cloneSolidifyElbowRemainderShape(shape, remainingItems));
            }
        });
        const mergedShapes = layerGroups.map(group => (
            createSolidifyElbowMergedShape(group, settings)
        ));
        replacementShapes.push(...mergedShapes);
        replacements.set(layerName, { sourceShapes, replacementShapes, mergedShapes });
    });
    return replacements;
}

function applySolidifyElbowLayerReplacements(replacements) {
    const replacedShapes = new Set();
    replacements.forEach(replacement => {
        replacement.sourceShapes.forEach(shape => replacedShapes.add(shape));
    });
    allShapesSorted = allShapesSorted.filter(shape => !replacedShapes.has(shape));
    replacements.forEach((replacement, layerName) => {
        layerIndex[layerName] = replacement.replacementShapes;
        totalCommands[layerName] = replacement.replacementShapes.reduce(
            (total, shape) => total + (Array.isArray(shape.items) ? shape.items.length : 0),
            0
        );
        allShapesSorted.push(...replacement.replacementShapes);
    });
    if (typeof refreshStraightDashRendering === 'function') {
        refreshStraightDashRendering();
    } else {
        sortShapesForDraw(allShapesSorted);
        rebuildQuadtree();
        scheduleDraw();
    }
}

async function solidifyDashedElbowInBbox(bbox) {
    if (solidifyElbowBboxBusy) return { mergedCount: 0, bridgeCount: 0 };
    const bounds = normalizeSolidifyElbowBbox(bbox);
    if (!bounds) {
        setSolidifyElbowBboxButtonMessage('BBox không hợp lệ');
        return { mergedCount: 0, bridgeCount: 0 };
    }

    solidifyElbowBboxBusy = true;
    updateSolidifyElbowBboxButtonState();
    if (typeof invalidateStraightDashRenderState === 'function') {
        invalidateStraightDashRenderState();
    }
    await yieldToBrowser();

    try {
        const settings = getSolidifyElbowSettings();
        const candidates = collectSolidifyElbowCandidates(bounds, settings);
        const edges = buildSolidifyElbowEdges(candidates, settings);
        const selectedEdges = selectSolidifyElbowChainEdges(candidates, edges);
        const groups = buildSolidifyElbowGroups(candidates, selectedEdges);
        if (!groups.length) {
            solidifyElbowBboxBusy = false;
            updateSolidifyElbowBboxButtonState();
            setSolidifyElbowBboxButtonMessage('Không thấy elbow nét đứt trong bbox');
            return { mergedCount: 0, bridgeCount: 0 };
        }

        const replacements = buildSolidifyElbowLayerReplacements(groups, settings);
        if (!replacements.size) {
            solidifyElbowBboxBusy = false;
            updateSolidifyElbowBboxButtonState();
            setSolidifyElbowBboxButtonMessage('Không có nét phù hợp để nối');
            return { mergedCount: 0, bridgeCount: 0 };
        }

        // Keep an existing whole-page straight conversion, but drop its stale
        // undo snapshot before applying a bbox replacement on top of it.
        if (solidLineConversionActive && typeof resetSolidLineConversionState === 'function') {
            resetSolidLineConversionState({ removeShapes: false, refresh: false });
        }

        const bridgeCount = groups.reduce(
            (total, group) => total + group.edges.filter(edge => !edge.isCoincident).length,
            0
        );
        const curveCommandCount = Array.from(replacements.values()).reduce(
            (total, replacement) => total + replacement.mergedShapes.reduce(
                (layerTotal, shape) => layerTotal + (shape._solidifyElbowCurveCommandCount || 0),
                0
            ),
            0
        );
        applySolidifyElbowLayerReplacements(replacements);
        solidifyElbowBboxBusy = false;
        updateSolidifyElbowBboxButtonState();
        setSolidifyElbowBboxButtonMessage(
            `Đã nối ${groups.length} elbow (${curveCommandCount} lệnh c)`
        );
        return { mergedCount: groups.length, bridgeCount, curveCommandCount };
    } catch (error) {
        console.error('Cannot solidify dashed elbow inside bbox:', error);
        solidifyElbowBboxBusy = false;
        updateSolidifyElbowBboxButtonState();
        setSolidifyElbowBboxButtonMessage('Nối elbow thất bại');
        return { mergedCount: 0, bridgeCount: 0, error };
    }
}

window.solidifyDashedElbowInBbox = solidifyDashedElbowInBbox;

if (btnSolidifyElbowBbox) {
    btnSolidifyElbowBbox.addEventListener('click', () => {
        if (solidifyElbowBboxBusy) return;
        if (isSolidifyElbowBboxMode) deactivateSolidifyElbowBboxMode();
        else activateSolidifyElbowBboxMode();
    });
    updateSolidifyElbowBboxButtonState();
}
