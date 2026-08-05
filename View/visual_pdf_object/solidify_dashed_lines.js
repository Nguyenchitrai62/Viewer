// Straight dashed-line merge tool.
// Intentionally handles only `l` commands. Curves (`c`) are left untouched.
let solidLineConversionState = null;
let solidLineConversionActive = false;
let solidLineConversionBusy = false;
let solidLineButtonMessageTimer = null;
let solidLineMergedShapeSequence = 0;

function getSolidLineConfigNumber(key, fallback, options = {}) {
    const configuredValue = Number(CONFIG?.[key]);
    let value = Number.isFinite(configuredValue) ? configuredValue : fallback;
    if (Number.isFinite(options.min)) value = Math.max(options.min, value);
    if (Number.isFinite(options.max)) value = Math.min(options.max, value);
    if (options.integer) value = Math.round(value);
    return value;
}

function getSolidLineConfigBoolean(key, fallback) {
    const configuredValue = CONFIG?.[key];
    return typeof configuredValue === 'boolean' ? configuredValue : fallback;
}

function getStraightDashSettings() {
    const segmentMaxLength = getSolidLineConfigNumber(
        'SOLIDIFY_STRAIGHT_DASH_SEGMENT_MAX_LENGTH',
        50,
        { min: 0.0001 }
    );
    const lengthToleranceRatio = getSolidLineConfigNumber(
        'SOLIDIFY_STRAIGHT_DASH_SEGMENT_LENGTH_TOLERANCE_RATIO',
        2,
        { min: 1 }
    );
    const spatialCellMinSize = getSolidLineConfigNumber(
        'SOLIDIFY_STRAIGHT_DASH_SPATIAL_CELL_MIN_SIZE',
        5,
        { min: 0.1 }
    );
    const spatialCellMaxSize = Math.max(
        spatialCellMinSize,
        getSolidLineConfigNumber(
            'SOLIDIFY_STRAIGHT_DASH_SPATIAL_CELL_MAX_SIZE',
            15,
            { min: 0.1 }
        )
    );
    return {
        epsilon: getSolidLineConfigNumber(
            'SOLIDIFY_STRAIGHT_DASH_EPSILON',
            1e-5,
            { min: Number.EPSILON }
        ),
        segmentMaxLength,
        lengthToleranceRatio,
        effectiveSegmentMaxLength: segmentMaxLength * lengthToleranceRatio,
        maxGapToLengthRatio: getSolidLineConfigNumber(
            'SOLIDIFY_STRAIGHT_DASH_MAX_GAP_TO_LENGTH_RATIO',
            1.5,
            { min: 0.01 }
        ),
        maxLateralOffset: getSolidLineConfigNumber(
            'SOLIDIFY_STRAIGHT_DASH_MAX_LATERAL_OFFSET',
            1,
            { min: 0 }
        ),
        maxAngleDegrees: getSolidLineConfigNumber(
            'SOLIDIFY_STRAIGHT_DASH_MAX_ANGLE_DEGREES',
            5,
            { min: 0.01, max: 45 }
        ),
        minSegmentsPerGroup: getSolidLineConfigNumber(
            'SOLIDIFY_STRAIGHT_DASH_MIN_SEGMENTS_PER_GROUP',
            2,
            { min: 2, integer: true }
        ),
        searchGapMultiplier: getSolidLineConfigNumber(
            'SOLIDIFY_STRAIGHT_DASH_SEARCH_GAP_MULTIPLIER',
            1.25,
            { min: 1 }
        ),
        scoreLateralWeight: getSolidLineConfigNumber(
            'SOLIDIFY_STRAIGHT_DASH_SCORE_LATERAL_WEIGHT',
            4,
            { min: 0 }
        ),
        useSeqnoGroupPriority: getSolidLineConfigBoolean(
            'SOLIDIFY_STRAIGHT_DASH_USE_SEQNO_GROUP_PRIORITY',
            true
        ),
        maxFallbackNeighborsPerSide: getSolidLineConfigNumber(
            'SOLIDIFY_STRAIGHT_DASH_MAX_FALLBACK_NEIGHBORS_PER_SIDE',
            1,
            { min: 1, integer: true }
        ),
        maxCandidatesPerGroup: getSolidLineConfigNumber(
            'SOLIDIFY_STRAIGHT_DASH_MAX_CANDIDATES_PER_GROUP',
            0,
            { min: 0, integer: true }
        ),
        spatialCellMinSize,
        spatialCellMaxSize,
        spatialCellDivisor: getSolidLineConfigNumber(
            'SOLIDIFY_STRAIGHT_DASH_SPATIAL_CELL_DIVISOR',
            8,
            { min: 1 }
        ),
        shapeYieldInterval: getSolidLineConfigNumber(
            'SOLIDIFY_STRAIGHT_DASH_SHAPE_YIELD_INTERVAL',
            2500,
            { min: 1, integer: true }
        ),
        endpointYieldInterval: getSolidLineConfigNumber(
            'SOLIDIFY_STRAIGHT_DASH_ENDPOINT_YIELD_INTERVAL',
            3000,
            { min: 1, integer: true }
        ),
        buttonMessageDurationMs: getSolidLineConfigNumber(
            'SOLIDIFY_STRAIGHT_DASH_BUTTON_MESSAGE_DURATION_MS',
            1800,
            { min: 0, integer: true }
        )
    };
}

function isSolidLineSourceLayer(layerName) {
    return Boolean(
        layerName
        && !layerName.startsWith('svg_')
        && !pipelineLayerNames.includes(layerName)
        && !detectionLayerNames.includes(layerName)
    );
}

function isSolidLineStrokeShape(shape) {
    return Boolean(
        shape
        && !shape.fill
        && shape.color !== null
        && shape.color !== undefined
        && Array.isArray(shape.items)
        && shape.items.some(item => item?.[0] === 'l')
    );
}

function getVisibleSolidLineLayerNames() {
    const knownLayerNames = new Set([
        ...Object.keys(layerIndex || {}),
        ...(Array.isArray(sortedLayerKeys) ? sortedLayerKeys : [])
    ]);
    return Array.from(knownLayerNames).filter(layerName => {
        if (!isSolidLineSourceLayer(layerName) || layerVisibility[layerName] === false) {
            return false;
        }
        const shapes = layerIndex[layerName];
        return Array.isArray(shapes) && shapes.some(isSolidLineStrokeShape);
    });
}

function setSolidLineButtonMessage(message, durationMs = null) {
    if (!btnSolidifyDashedLines) return;
    if (solidLineButtonMessageTimer) {
        clearTimeout(solidLineButtonMessageTimer);
    }
    btnSolidifyDashedLines.textContent = message;
    solidLineButtonMessageTimer = setTimeout(() => {
        solidLineButtonMessageTimer = null;
        updateSolidLineButtonState();
    }, durationMs ?? getStraightDashSettings().buttonMessageDurationMs);
}

function updateSolidLineButtonState() {
    if (!btnSolidifyDashedLines) return;
    btnSolidifyDashedLines.disabled = Boolean(
        !solidLineConversionActive
        && !solidLineConversionBusy
        && getVisibleSolidLineLayerNames().length === 0
    );
    btnSolidifyDashedLines.classList.toggle('is-active', solidLineConversionActive);
    btnSolidifyDashedLines.setAttribute('aria-pressed', solidLineConversionActive ? 'true' : 'false');
    btnSolidifyDashedLines.setAttribute('aria-busy', solidLineConversionBusy ? 'true' : 'false');

    if (solidLineButtonMessageTimer) return;
    if (solidLineConversionBusy) {
        btnSolidifyDashedLines.textContent = 'Đang nối nét thẳng...';
        return;
    }
    if (solidLineConversionActive) {
        btnSolidifyDashedLines.textContent = `↩ Khôi phục nét đứt (${solidLineConversionState?.mergedCount || 0})`;
        btnSolidifyDashedLines.title = 'Khôi phục các đoạn nét đứt thẳng ban đầu';
        return;
    }
    btnSolidifyDashedLines.textContent = '〰 Nét đứt → liền';
    btnSolidifyDashedLines.title = 'Nối khoảng trống giữa các nét đứt thẳng của layer đang bật';
}

function getSolidLinePoint(rawPoint) {
    if (!Array.isArray(rawPoint) || rawPoint.length < 2) return null;
    const x = Number(rawPoint[0]);
    const y = Number(rawPoint[1]);
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

function getSolidLineDistance(pointA, pointB) {
    return Math.hypot(pointB[0] - pointA[0], pointB[1] - pointA[1]);
}

function normalizeSolidLineVector(vector, epsilon) {
    const length = Math.hypot(vector[0], vector[1]);
    if (!Number.isFinite(length) || length <= epsilon) return null;
    return [vector[0] / length, vector[1] / length];
}

function dotSolidLineVectors(vectorA, vectorB) {
    return vectorA[0] * vectorB[0] + vectorA[1] * vectorB[1];
}

function negateSolidLineVector(vector) {
    return [-vector[0], -vector[1]];
}

function getSolidLineShapeStyleKey(shape) {
    return [
        JSON.stringify(shape.color ?? null),
        Number.isFinite(Number(shape.width)) ? Number(shape.width) : '',
        JSON.stringify(shape.lineCap ?? null),
        JSON.stringify(shape.lineJoin ?? null)
    ].join('|');
}

async function extractStraightDashCandidates(layerName, shapes, settings) {
    const candidates = [];
    const maximumLength = settings.effectiveSegmentMaxLength;

    for (let shapeIndex = 0; shapeIndex < shapes.length; shapeIndex += 1) {
        const shape = shapes[shapeIndex];
        if (!isSolidLineStrokeShape(shape) || shape._isSolidLineMerged) continue;
        const styleKey = getSolidLineShapeStyleKey(shape);
        const rawSeqno = Number(shape.seqno);
        const seqno = Number.isFinite(rawSeqno) ? rawSeqno : null;
        const seqnoGroupId = (
            seqno !== null
            && typeof seqnoGroups === 'object'
            && seqnoGroups !== null
            && Object.prototype.hasOwnProperty.call(seqnoGroups, seqno)
        )
            ? seqnoGroups[seqno]
            : null;
        const seqnoGroupSize = (
            seqnoGroupId !== null
            && typeof groupToSeqnos === 'object'
            && groupToSeqnos !== null
            && Array.isArray(groupToSeqnos[seqnoGroupId])
        )
            ? groupToSeqnos[seqnoGroupId].length
            : 0;

        for (let itemIndex = 0; itemIndex < shape.items.length; itemIndex += 1) {
            const item = shape.items[itemIndex];
            if (item?.[0] !== 'l') continue;
            const start = getSolidLinePoint(item[1]);
            const end = getSolidLinePoint(item[2]);
            if (!start || !end) continue;
            const length = getSolidLineDistance(start, end);
            if (length <= settings.epsilon || length > maximumLength) continue;
            const direction = normalizeSolidLineVector([
                end[0] - start[0],
                end[1] - start[1]
            ], settings.epsilon);
            if (!direction) continue;

            candidates.push({
                id: candidates.length,
                layerName,
                shape,
                itemIndex,
                start,
                end,
                length,
                direction,
                styleKey,
                seqno,
                seqnoGroupIds: seqnoGroupId !== null ? [seqnoGroupId] : [],
                seqnoGroupSize
            });
        }

        if (shapeIndex > 0 && shapeIndex % settings.shapeYieldInterval === 0) {
            await yieldToBrowser();
        }
    }
    return candidates;
}

function getStraightDashCellKey(cellX, cellY) {
    return `${cellX},${cellY}`;
}

function getStraightDashCandidateBounds(candidate) {
    return {
        minX: Math.min(candidate.start[0], candidate.end[0]),
        minY: Math.min(candidate.start[1], candidate.end[1]),
        maxX: Math.max(candidate.start[0], candidate.end[0]),
        maxY: Math.max(candidate.start[1], candidate.end[1])
    };
}

function buildStraightDashCandidateGrid(candidates, cellSize) {
    const grid = new Map();
    candidates.forEach(candidate => {
        const bounds = getStraightDashCandidateBounds(candidate);
        const startCellX = Math.floor(bounds.minX / cellSize);
        const startCellY = Math.floor(bounds.minY / cellSize);
        const endCellX = Math.floor(bounds.maxX / cellSize);
        const endCellY = Math.floor(bounds.maxY / cellSize);

        for (let cellX = startCellX; cellX <= endCellX; cellX += 1) {
            for (let cellY = startCellY; cellY <= endCellY; cellY += 1) {
                const cellKey = getStraightDashCellKey(cellX, cellY);
                let styleMap = grid.get(cellKey);
                if (!styleMap) {
                    styleMap = new Map();
                    grid.set(cellKey, styleMap);
                }
                const cellCandidates = styleMap.get(candidate.styleKey) || [];
                cellCandidates.push(candidate.id);
                styleMap.set(candidate.styleKey, cellCandidates);
            }
        }
    });
    return grid;
}

function queryStraightDashCandidateGrid(candidate, grid, cellSize, settings) {
    const searchPadding = (
        candidate.length
        * settings.lengthToleranceRatio
        * settings.maxGapToLengthRatio
        * settings.searchGapMultiplier
    ) + settings.maxLateralOffset;
    const bounds = getStraightDashCandidateBounds(candidate);
    const startCellX = Math.floor((bounds.minX - searchPadding) / cellSize);
    const startCellY = Math.floor((bounds.minY - searchPadding) / cellSize);
    const endCellX = Math.floor((bounds.maxX + searchPadding) / cellSize);
    const endCellY = Math.floor((bounds.maxY + searchPadding) / cellSize);
    const candidateIds = new Set();

    for (let cellX = startCellX; cellX <= endCellX; cellX += 1) {
        for (let cellY = startCellY; cellY <= endCellY; cellY += 1) {
            const styleMap = grid.get(getStraightDashCellKey(cellX, cellY));
            const cellCandidates = styleMap?.get(candidate.styleKey);
            if (!cellCandidates) continue;
            cellCandidates.forEach(candidateId => candidateIds.add(candidateId));
        }
    }
    return candidateIds;
}

function getStraightDashProjectionRange(candidate, origin, direction) {
    const projections = [candidate.start, candidate.end]
        .map(point => (
            ((point[0] - origin[0]) * direction[0])
            + ((point[1] - origin[1]) * direction[1])
        ))
        .sort((left, right) => left - right);
    return [projections[0], projections[1]];
}

function getStraightDashAxisOffset(candidate, origin, direction) {
    return Math.max(...[candidate.start, candidate.end].map(point => Math.abs(
        ((point[0] - origin[0]) * (-direction[1]))
        + ((point[1] - origin[1]) * direction[0])
    )));
}

function getStraightDashFacingPoint(candidate, origin, direction, preferMaximum) {
    const projectedPoints = [candidate.start, candidate.end]
        .map(point => ({
            point,
            projection: (
                ((point[0] - origin[0]) * direction[0])
                + ((point[1] - origin[1]) * direction[1])
            )
        }))
        .sort((left, right) => left.projection - right.projection);
    return preferMaximum
        ? projectedPoints[projectedPoints.length - 1].point
        : projectedPoints[0].point;
}

function doStraightDashCandidatesShareSeqnoGroup(candidateA, candidateB) {
    if (!candidateA?.seqnoGroupIds?.length || !candidateB?.seqnoGroupIds?.length) {
        return false;
    }
    const groupIdsA = new Set(candidateA.seqnoGroupIds);
    return candidateB.seqnoGroupIds.some(groupId => groupIdsA.has(groupId));
}

function getStraightDashCompatibility(
    referenceCandidate,
    currentCandidate,
    neighborCandidate,
    minimumAlignment,
    settings
) {
    if (
        !referenceCandidate
        || !currentCandidate
        || !neighborCandidate
        || currentCandidate.id === neighborCandidate.id
        || currentCandidate.styleKey !== neighborCandidate.styleKey
    ) {
        return null;
    }

    const currentAlignment = Math.abs(
        dotSolidLineVectors(referenceCandidate.direction, currentCandidate.direction)
    );
    const neighborAlignment = Math.abs(
        dotSolidLineVectors(referenceCandidate.direction, neighborCandidate.direction)
    );
    if (currentAlignment < minimumAlignment || neighborAlignment < minimumAlignment) {
        return null;
    }

    const shorterLength = Math.min(currentCandidate.length, neighborCandidate.length);
    const longerLength = Math.max(currentCandidate.length, neighborCandidate.length);
    if (longerLength > shorterLength * settings.lengthToleranceRatio + settings.epsilon) {
        return null;
    }

    const direction = referenceCandidate.direction;
    const origin = referenceCandidate.start;
    const sharedSeqnoGroup = (
        doStraightDashCandidatesShareSeqnoGroup(currentCandidate, neighborCandidate)
        || doStraightDashCandidatesShareSeqnoGroup(referenceCandidate, neighborCandidate)
    );
    const currentAxisOffset = getStraightDashAxisOffset(currentCandidate, origin, direction);
    const neighborAxisOffset = getStraightDashAxisOffset(neighborCandidate, origin, direction);
    if (
        !sharedSeqnoGroup
        && (
            currentAxisOffset > settings.maxLateralOffset
            || neighborAxisOffset > settings.maxLateralOffset
        )
    ) {
        return null;
    }

    const currentRange = getStraightDashProjectionRange(currentCandidate, origin, direction);
    const neighborRange = getStraightDashProjectionRange(neighborCandidate, origin, direction);
    let side = null;
    let gap = Infinity;
    let currentFacingPoint = null;
    let neighborFacingPoint = null;

    if (currentRange[1] <= neighborRange[0]) {
        side = 'forward';
        gap = neighborRange[0] - currentRange[1];
        currentFacingPoint = getStraightDashFacingPoint(
            currentCandidate,
            origin,
            direction,
            true
        );
        neighborFacingPoint = getStraightDashFacingPoint(
            neighborCandidate,
            origin,
            direction,
            false
        );
    } else if (neighborRange[1] <= currentRange[0]) {
        side = 'backward';
        gap = currentRange[0] - neighborRange[1];
        currentFacingPoint = getStraightDashFacingPoint(
            currentCandidate,
            origin,
            direction,
            false
        );
        neighborFacingPoint = getStraightDashFacingPoint(
            neighborCandidate,
            origin,
            direction,
            true
        );
    }

    // This button is destructive, so only consume a real dashed gap. Exact
    // endpoint continuations remain untouched even though Extract_FIRE may
    // traverse them when it builds a non-destructive topology annotation.
    if (!side || !Number.isFinite(gap) || gap <= settings.epsilon) return null;
    const maximumGap = longerLength * settings.maxGapToLengthRatio;
    if (gap > maximumGap + settings.epsilon) return null;

    const lateralOffset = Math.abs(
        ((neighborFacingPoint[0] - currentFacingPoint[0]) * (-direction[1]))
        + ((neighborFacingPoint[1] - currentFacingPoint[1]) * direction[0])
    );
    if (lateralOffset > settings.maxLateralOffset + settings.epsilon) return null;

    return {
        side,
        gap,
        lateralOffset,
        sharedSeqnoGroup,
        score: gap
            + lateralOffset * settings.scoreLateralWeight
            + ((1 - currentAlignment) + (1 - neighborAlignment)) * maximumGap
    };
}

function compareStraightDashNeighborEntries(left, right, settings) {
    const scoreDifference = left.compatibility.score - right.compatibility.score;
    if (Math.abs(scoreDifference) > settings.epsilon) return scoreDifference;
    const gapDifference = left.compatibility.gap - right.compatibility.gap;
    if (Math.abs(gapDifference) > settings.epsilon) return gapDifference;
    const lengthDifference = left.candidate.length - right.candidate.length;
    if (Math.abs(lengthDifference) > settings.epsilon) return lengthDifference;
    return left.candidate.id - right.candidate.id;
}

function getStraightDashAlignedNeighbors(
    referenceCandidate,
    currentCandidate,
    candidates,
    blockedCandidateIds,
    grid,
    cellSize,
    minimumAlignment,
    settings
) {
    const sharedNeighborsBySide = new Map();
    const fallbackNeighborsBySide = new Map();
    const nearbyCandidateIds = queryStraightDashCandidateGrid(
        currentCandidate,
        grid,
        cellSize,
        settings
    );

    nearbyCandidateIds.forEach(candidateId => {
        if (
            candidateId === currentCandidate.id
            || blockedCandidateIds.has(candidateId)
        ) {
            return;
        }
        const candidate = candidates[candidateId];
        const compatibility = getStraightDashCompatibility(
            referenceCandidate,
            currentCandidate,
            candidate,
            minimumAlignment,
            settings
        );
        if (!compatibility) return;

        const targetMap = (
            settings.useSeqnoGroupPriority
            && compatibility.sharedSeqnoGroup
        )
            ? sharedNeighborsBySide
            : fallbackNeighborsBySide;
        const entries = targetMap.get(compatibility.side) || [];
        entries.push({ candidate, compatibility });
        targetMap.set(compatibility.side, entries);
    });

    return ['backward', 'forward'].flatMap(side => {
        const sharedEntries = (sharedNeighborsBySide.get(side) || [])
            .sort((left, right) => compareStraightDashNeighborEntries(left, right, settings));
        if (sharedEntries.length) {
            return sharedEntries.map(entry => entry.candidate);
        }
        return (fallbackNeighborsBySide.get(side) || [])
            .sort((left, right) => compareStraightDashNeighborEntries(left, right, settings))
            .slice(0, settings.maxFallbackNeighborsPerSide)
            .map(entry => entry.candidate);
    });
}

async function collectStraightDashGroupFromSeed(
    seedCandidate,
    candidates,
    consumedCandidateIds,
    grid,
    cellSize,
    minimumAlignment,
    settings
) {
    const groupedCandidates = [];
    const queuedCandidateIds = new Set([seedCandidate.id]);
    const seenCandidateIds = new Set();
    const queue = [seedCandidate];
    let queueIndex = 0;

    while (queueIndex < queue.length) {
        if (
            settings.maxCandidatesPerGroup > 0
            && groupedCandidates.length >= settings.maxCandidatesPerGroup
        ) {
            break;
        }
        const currentCandidate = queue[queueIndex];
        queueIndex += 1;
        if (
            !currentCandidate
            || seenCandidateIds.has(currentCandidate.id)
            || consumedCandidateIds.has(currentCandidate.id)
        ) {
            continue;
        }
        seenCandidateIds.add(currentCandidate.id);

        const seedAlignment = Math.abs(
            dotSolidLineVectors(seedCandidate.direction, currentCandidate.direction)
        );
        if (
            currentCandidate.styleKey !== seedCandidate.styleKey
            || seedAlignment < minimumAlignment
        ) {
            continue;
        }

        groupedCandidates.push(currentCandidate);
        const neighbors = getStraightDashAlignedNeighbors(
            seedCandidate,
            currentCandidate,
            candidates,
            consumedCandidateIds,
            grid,
            cellSize,
            minimumAlignment,
            settings
        );
        neighbors.forEach(neighborCandidate => {
            if (
                seenCandidateIds.has(neighborCandidate.id)
                || queuedCandidateIds.has(neighborCandidate.id)
                || consumedCandidateIds.has(neighborCandidate.id)
            ) {
                return;
            }
            queuedCandidateIds.add(neighborCandidate.id);
            queue.push(neighborCandidate);
        });

        if (
            groupedCandidates.length > 0
            && groupedCandidates.length % settings.endpointYieldInterval === 0
        ) {
            await yieldToBrowser();
        }
    }
    return groupedCandidates;
}

async function buildStraightDashGroups(candidates, settings) {
    if (candidates.length < settings.minSegmentsPerGroup) return [];
    const cellSize = Math.max(
        settings.spatialCellMinSize,
        Math.min(
            settings.spatialCellMaxSize,
            settings.effectiveSegmentMaxLength / settings.spatialCellDivisor
        )
    );
    const grid = buildStraightDashCandidateGrid(candidates, cellSize);
    const minimumAlignment = Math.cos(settings.maxAngleDegrees * Math.PI / 180);
    const consumedCandidateIds = new Set();
    const groups = [];
    const seeds = candidates.slice().sort((left, right) => {
        const seqnoGroupDifference = right.seqnoGroupSize - left.seqnoGroupSize;
        if (seqnoGroupDifference !== 0) return seqnoGroupDifference;
        const lengthDifference = right.length - left.length;
        if (Math.abs(lengthDifference) > settings.epsilon) return lengthDifference;
        return left.id - right.id;
    });

    for (let seedIndex = 0; seedIndex < seeds.length; seedIndex += 1) {
        const seedCandidate = seeds[seedIndex];
        if (consumedCandidateIds.has(seedCandidate.id)) continue;
        const group = await collectStraightDashGroupFromSeed(
            seedCandidate,
            candidates,
            consumedCandidateIds,
            grid,
            cellSize,
            minimumAlignment,
            settings
        );
        if (group.length < settings.minSegmentsPerGroup) continue;
        group.forEach(candidate => consumedCandidateIds.add(candidate.id));
        groups.push(group);

        if (seedIndex > 0 && seedIndex % settings.endpointYieldInterval === 0) {
            await yieldToBrowser();
        }
    }
    return groups;
}

function getStraightDashGroupEndpoints(group, settings) {
    let direction = [...group[0].direction];
    if (
        direction[0] < 0
        || (Math.abs(direction[0]) <= settings.epsilon && direction[1] < 0)
    ) {
        direction = negateSolidLineVector(direction);
    }
    let minimumProjection = Infinity;
    let maximumProjection = -Infinity;
    let startPoint = null;
    let endPoint = null;
    group.forEach(candidate => {
        [candidate.start, candidate.end].forEach(point => {
            const projection = point[0] * direction[0] + point[1] * direction[1];
            if (projection < minimumProjection) {
                minimumProjection = projection;
                startPoint = point;
            }
            if (projection > maximumProjection) {
                maximumProjection = projection;
                endPoint = point;
            }
        });
    });
    return { startPoint, endPoint };
}

function createStraightDashMergedShape(layerName, group, settings) {
    const sourceShape = group[0].shape;
    const { startPoint, endPoint } = getStraightDashGroupEndpoints(group, settings);
    const sequenceNumbers = group
        .map(candidate => Number(candidate.shape.seqno))
        .filter(Number.isFinite);
    const mergedShape = {
        ...sourceShape,
        id: `solid-line-merged-${Date.now()}-${++solidLineMergedShapeSequence}`,
        type: 's',
        layer: layerName,
        items: [['l', [...startPoint], [...endPoint]]],
        closePath: false,
        fill: null,
        rect: null,
        bbox: null,
        dashes: '[] 0',
        seqno: sequenceNumbers.length ? Math.min(...sequenceNumbers) : 0,
        _isSolidLineMerged: true,
        _solidLineSourceCount: group.length
    };
    prepareShapeForDraw(mergedShape, sourceShape._renderLayerPriority ?? 1, false);
    return mergedShape;
}

function cloneStraightDashRemainderShape(shape, items, layerName) {
    const clonedShape = {
        ...shape,
        id: `${shape.id ?? shape.seqno ?? 'shape'}-straight-remainder-${++solidLineMergedShapeSequence}`,
        layer: layerName,
        items,
        rect: null,
        bbox: null
    };
    prepareShapeForDraw(
        clonedShape,
        shape._renderLayerPriority ?? 1,
        Boolean(shape._isPipelineLayer)
    );
    return clonedShape;
}

function buildStraightDashLayerReplacement(layerName, sourceShapes, groups, settings) {
    if (!groups.length) return null;
    const consumedItemsByShape = new Map();
    const mergedShapes = groups.map(group => {
        group.forEach(candidate => {
            const consumedItems = consumedItemsByShape.get(candidate.shape) || new Set();
            consumedItems.add(candidate.itemIndex);
            consumedItemsByShape.set(candidate.shape, consumedItems);
        });
        return createStraightDashMergedShape(layerName, group, settings);
    });

    const replacementShapes = [];
    sourceShapes.forEach(shape => {
        const consumedItems = consumedItemsByShape.get(shape);
        if (!consumedItems) {
            replacementShapes.push(shape);
            return;
        }
        const remainingItems = shape.items.filter(
            (item, itemIndex) => !consumedItems.has(itemIndex)
        );
        if (remainingItems.length) {
            replacementShapes.push(
                cloneStraightDashRemainderShape(shape, remainingItems, layerName)
            );
        }
    });
    replacementShapes.push(...mergedShapes);
    return { replacementShapes, mergedShapes };
}

function invalidateStraightDashRenderState() {
    if (typeof cancelPendingVectorRender === 'function') {
        cancelPendingVectorRender();
    }
    if (typeof invalidateShapeRasterCache === 'function') {
        invalidateShapeRasterCache();
    }
    if (typeof invalidateSeqnoHoverIndex === 'function') {
        invalidateSeqnoHoverIndex();
    }
    if (typeof invalidateSnapPointIndex === 'function') {
        invalidateSnapPointIndex();
    }
}

function refreshStraightDashRendering() {
    sortShapesForDraw(allShapesSorted);
    rebuildQuadtree();
    invalidateStraightDashRenderState();
    applyLayerVisibilityUpdate({ refreshList: true });
}

function restoreStraightDashSourceLayers({ refresh = true } = {}) {
    if (!solidLineConversionState?.layers) return false;
    const currentShapes = new Set();
    solidLineConversionState.layers.forEach((snapshot, layerName) => {
        (layerIndex[layerName] || []).forEach(shape => currentShapes.add(shape));
        layerIndex[layerName] = snapshot.shapes;
        totalCommands[layerName] = snapshot.totalCommands;
    });
    allShapesSorted = allShapesSorted.filter(shape => !currentShapes.has(shape));
    solidLineConversionState.layers.forEach(snapshot => {
        allShapesSorted.push(...snapshot.shapes);
    });
    solidLineConversionState = null;
    solidLineConversionActive = false;

    if (refresh) {
        refreshStraightDashRendering();
    } else {
        updateSolidLineButtonState();
    }
    return true;
}

function resetSolidLineConversionState(options = {}) {
    if (solidLineButtonMessageTimer) {
        clearTimeout(solidLineButtonMessageTimer);
        solidLineButtonMessageTimer = null;
    }
    const shouldRemoveShapes = options.removeShapes !== false;
    const shouldRefresh = options.refresh !== false;
    if (shouldRemoveShapes && solidLineConversionState?.layers) {
        restoreStraightDashSourceLayers({ refresh: shouldRefresh });
        return;
    }
    solidLineConversionState = null;
    solidLineConversionActive = false;
    solidLineConversionBusy = false;
    updateSolidLineButtonState();
}

async function convertVisibleDashedLinesToSolid() {
    if (solidLineConversionBusy) return;
    if (typeof isSolidifyElbowBboxMode !== 'undefined' && isSolidifyElbowBboxMode
        && typeof deactivateSolidifyElbowBboxMode === 'function') {
        deactivateSolidifyElbowBboxMode();
    }
    if (solidLineConversionActive) {
        restoreStraightDashSourceLayers({ refresh: true });
        return;
    }

    const settings = getStraightDashSettings();
    const visibleLayerNames = getVisibleSolidLineLayerNames();
    if (!visibleLayerNames.length) {
        setSolidLineButtonMessage('Không có layer nét thẳng đang bật');
        return;
    }

    solidLineConversionBusy = true;
    updateSolidLineButtonState();
    invalidateStraightDashRenderState();
    await yieldToBrowser();

    try {
        const snapshots = new Map();
        const replacements = new Map();
        let mergedCount = 0;

        for (const layerName of visibleLayerNames) {
            const sourceShapes = layerIndex[layerName];
            if (!Array.isArray(sourceShapes) || !sourceShapes.length) continue;
            const candidates = await extractStraightDashCandidates(
                layerName,
                sourceShapes,
                settings
            );
            const groups = await buildStraightDashGroups(candidates, settings);
            if (!groups.length) continue;
            const replacement = buildStraightDashLayerReplacement(
                layerName,
                sourceShapes,
                groups,
                settings
            );
            if (!replacement) continue;
            snapshots.set(layerName, {
                shapes: sourceShapes,
                totalCommands: totalCommands[layerName] || 0
            });
            replacements.set(layerName, replacement.replacementShapes);
            mergedCount += replacement.mergedShapes.length;
            await yieldToBrowser();
        }

        if (!replacements.size) {
            solidLineConversionBusy = false;
            updateSolidLineButtonState();
            setSolidLineButtonMessage('Không tìm thấy nét đứt thẳng');
            return;
        }

        const originalShapes = new Set();
        snapshots.forEach(snapshot => {
            snapshot.shapes.forEach(shape => originalShapes.add(shape));
        });
        allShapesSorted = allShapesSorted.filter(shape => !originalShapes.has(shape));
        replacements.forEach((replacementShapes, layerName) => {
            layerIndex[layerName] = replacementShapes;
            totalCommands[layerName] = replacementShapes.reduce(
                (total, shape) => total + (Array.isArray(shape.items) ? shape.items.length : 0),
                0
            );
            allShapesSorted.push(...replacementShapes);
        });
        solidLineConversionState = {
            layers: snapshots,
            mergedCount
        };
        solidLineConversionActive = true;
        solidLineConversionBusy = false;
        refreshStraightDashRendering();
    } catch (error) {
        console.error('Cannot merge straight dashed lines:', error);
        solidLineConversionBusy = false;
        solidLineConversionState = null;
        solidLineConversionActive = false;
        updateSolidLineButtonState();
        setSolidLineButtonMessage('Nối nét đứt thất bại');
    }
}

if (btnSolidifyDashedLines) {
    btnSolidifyDashedLines.addEventListener('click', convertVisibleDashedLinesToSolid);
    updateSolidLineButtonState();
}
