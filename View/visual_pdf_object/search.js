// search.js

function getOrComputeLength(layerName, objIndex, itemIndex, type, item) {
    if (!precomputedLengths[layerName]) precomputedLengths[layerName] = {};
    if (!precomputedLengths[layerName][objIndex]) precomputedLengths[layerName][objIndex] = {};

    if (precomputedLengths[layerName][objIndex][itemIndex] !== undefined) {
        return precomputedLengths[layerName][objIndex][itemIndex];
    }

    const len = calculateLength(type, item);
    precomputedLengths[layerName][objIndex][itemIndex] = len;
    return len;
}

function clearCropModalWorkingSet() {
    cropItems = [];
    cropSelectedItemIds = new Set();
    cropSeqnoToIds = {};
    cropPreviewBbox = null;
    cropPreviewTransform = null;
    cropPreviewObjects = [];
    cropPreviewItemLookup = null;
    dragSelecting = false;
    selectionMode = 'hide';
    isCropModalOpen = false;
}

function rebuildCropPreviewLookup(croppedObjs) {
    cropPreviewObjects = Array.isArray(croppedObjs) ? croppedObjs.slice() : [];
    const nextLookup = new WeakMap();
    for (let index = 0; index < cropItems.length; index += 1) {
        const cropItem = cropItems[index];
        let objectLookup = nextLookup.get(cropItem.obj);
        if (!objectLookup) {
            objectLookup = new Map();
            nextLookup.set(cropItem.obj, objectLookup);
        }
        objectLookup.set(cropItem.itemIndex, cropItem.id);
    }
    cropPreviewItemLookup = nextLookup;
}

function redrawActiveCropPreview() {
    if (!cropPreviewBbox) return;
    const cropCanvas = document.getElementById('crop-canvas');
    if (!cropCanvas) return;
    const ctx2 = cropCanvas.getContext('2d');
    ctx2.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
    redrawCropPreview(ctx2, cropPreviewObjects, cropPreviewBbox, cropCanvas);
}

function drawCropPreviewRasterPlaceholder(cropCanvas, bboxRef) {
    if (!cropCanvas || !bboxRef || !shapeRasterCache?.canvas || !shapeRasterCache?.bounds) {
        return false;
    }

    const previewCtx = cropCanvas.getContext('2d');
    const rasterBounds = shapeRasterCache.bounds;
    const rasterScale = shapeRasterCache.scale || 1;
    const srcX = (bboxRef.x - rasterBounds.minX) * rasterScale;
    const srcY = (bboxRef.y - rasterBounds.minY) * rasterScale;
    const srcWidth = bboxRef.width * rasterScale;
    const srcHeight = bboxRef.height * rasterScale;

    if (!Number.isFinite(srcX) || !Number.isFinite(srcY) || srcWidth <= 0 || srcHeight <= 0) {
        return false;
    }

    const scaleX = cropCanvas.width / bboxRef.width;
    const scaleY = cropCanvas.height / bboxRef.height;
    const scale = Math.min(scaleX, scaleY);
    const drawWidth = bboxRef.width * scale;
    const drawHeight = bboxRef.height * scale;
    const offsetX2 = (cropCanvas.width - drawWidth) / 2;
    const offsetY2 = (cropCanvas.height - drawHeight) / 2;

    previewCtx.save();
    previewCtx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
    previewCtx.fillStyle = '#ffffff';
    previewCtx.fillRect(0, 0, cropCanvas.width, cropCanvas.height);
    previewCtx.drawImage(
        shapeRasterCache.canvas,
        srcX,
        srcY,
        srcWidth,
        srcHeight,
        offsetX2,
        offsetY2,
        drawWidth,
        drawHeight
    );
    previewCtx.restore();
    return true;
}

function resetSearchSessionState({
    clearLengthCache = false,
    clearFoundCount = false,
    clearVlmArtifacts = false,
    releaseTransientVectorCache = false
} = {}) {
    cropLengths = null;
    cropLengthsFull = null;
    cropLengthsFiltered = null;
    mainLayers = null;
    anchorBbox = null;
    similarBboxes = [];
    sequenceMatches = [];
    sequencePatternTokens = null;
    searchBboxSize = null;
    anchorPatterns = [];
    rawAnchorPatternCount = 0;
    lastSearchMs = 0;
    lastSequenceSearchMs = 0;
    expandedNodes = {};
    isApplyingSavedPattern = false;
    clearCropModalWorkingSet();

    if (clearLengthCache) {
        precomputedLengths = {};
    }

    if (clearVlmArtifacts) {
        pendingVLMCrop = null;
        pendingVLMBbox = null;
        if (typeof clearDetectedCellOverlay === 'function') {
            clearDetectedCellOverlay();
        } else {
            extractedCellOverlays = [];
            extractedCellDownloadBundle = null;
        }
    }

    if (clearFoundCount) {
        const foundCountDiv = document.getElementById('found-count');
        if (foundCountDiv) {
            foundCountDiv.style.display = 'none';
        }
    }

    if (releaseTransientVectorCache && typeof cancelPendingVectorRender === 'function') {
        cancelPendingVectorRender();
    }
}

function hasActiveSearchCanvasState() {
    return Boolean(
        bboxStart ||
        currentBbox ||
        cropLengths ||
        cropLengthsFull ||
        cropLengthsFiltered ||
        mainLayers ||
        anchorBbox ||
        searchBboxSize ||
        cropPreviewBbox ||
        similarBboxes.length ||
        sequenceMatches.length ||
        anchorPatterns.length ||
        rawAnchorPatternCount ||
        sequencePatternTokens ||
        isApplyingSavedPattern ||
        isCropModalOpen
    );
}

function getFindPopupPageCacheKey() {
    return [
        currentPageNum ?? 'json',
        currentLayerField || '',
        jsonShapes?.length || 0,
        allShapesSorted?.length || 0
    ].join('|');
}

function invalidateFindPopupPageCache() {
    findPopupPageCache = null;
    findPopupPageCacheBuildPromise = null;
    findPopupPageCacheWarmScheduled = false;
    findPopupPageCacheBuildToken += 1;
}

function buildFindPopupObjectMeta(obj, layerName, objIndex) {
    if (!obj || obj.type === 'text' || !obj.rect || !Array.isArray(obj.items)) {
        return null;
    }

    const commands = [];
    const commandCounts = { l: 0, c: 0, qu: 0 };

    for (let itemIndex = 0; itemIndex < obj.items.length; itemIndex += 1) {
        const item = obj.items[itemIndex];
        const type = item[0];
        if (!(type === 'l' || type === 'c' || type === 'qu')) continue;

        const length = getOrComputeLength(layerName, objIndex, itemIndex, type, item);
        let anchorX;
        let anchorY;
        if (type === 'l' || type === 'c') {
            [anchorX, anchorY] = item[1];
        } else {
            const points = item[1];
            if (!points?.length) continue;
            [anchorX, anchorY] = points[0];
        }

        commands.push({ type, length, anchorX, anchorY, itemIndex });
        commandCounts[type] += 1;
    }

    return {
        layer: layerName,
        objIndex,
        seqno: obj.seqno || objIndex,
        colorStr: obj.color ? toRgbString(obj.color) : 'rgba(0, 0, 0, 1)',
        commands,
        commandCounts
    };
}

async function buildFindPopupPageCache(cacheKey, token) {
    const objectMetaByObject = new WeakMap();
    let processedObjects = 0;

    const layerNames = Object.keys(layerIndex || {});
    for (let layerPos = 0; layerPos < layerNames.length; layerPos += 1) {
        const layerName = layerNames[layerPos];
        const layerArr = layerIndex[layerName] || [];
        for (let objIndex = 0; objIndex < layerArr.length; objIndex += 1) {
            const obj = layerArr[objIndex];
            const meta = buildFindPopupObjectMeta(obj, layerName, objIndex);
            if (meta) {
                objectMetaByObject.set(obj, meta);
            }

            processedObjects += 1;
            if (typeof yieldToBrowser === 'function' && processedObjects % 150 === 0) {
                await yieldToBrowser();
                if (token !== findPopupPageCacheBuildToken || getFindPopupPageCacheKey() !== cacheKey) {
                    return null;
                }
            }
        }
    }

    if (token !== findPopupPageCacheBuildToken || getFindPopupPageCacheKey() !== cacheKey) {
        return null;
    }

    const cache = { key: cacheKey, objectMetaByObject };
    findPopupPageCache = cache;
    return cache;
}

async function ensureFindPopupPageCache() {
    const cacheKey = getFindPopupPageCacheKey();
    if (findPopupPageCache?.key === cacheKey) {
        return findPopupPageCache;
    }

    if (findPopupPageCacheBuildPromise) {
        const pendingCache = await findPopupPageCacheBuildPromise;
        if (pendingCache?.key === cacheKey) {
            return pendingCache;
        }
    }

    const token = ++findPopupPageCacheBuildToken;
    const buildPromise = buildFindPopupPageCache(cacheKey, token)
        .catch(error => {
            console.warn('Find popup page cache build failed:', error);
            return null;
        })
        .finally(() => {
            if (findPopupPageCacheBuildPromise === buildPromise) {
                findPopupPageCacheBuildPromise = null;
            }
        });

    findPopupPageCacheBuildPromise = buildPromise;
    return await buildPromise;
}

function scheduleFindPopupPageCacheWarmup() {
    if (findPopupPageCacheWarmScheduled || !allShapesSorted?.length) {
        return;
    }

    const cacheKey = getFindPopupPageCacheKey();
    if (findPopupPageCache?.key === cacheKey) {
        return;
    }

    findPopupPageCacheWarmScheduled = true;
    requestAnimationFrame(() => {
        findPopupPageCacheWarmScheduled = false;
        ensureFindPopupPageCache().catch(error => {
            console.warn('Find popup page cache warmup failed:', error);
        });
    });
}

// FIXED: Sử dụng cropSeqnoToIds (chỉ cho crop modal)
function applySelectionAtPoint(worldX, worldY) {
    if (!cropItems.length) return;
    const scale = cropPreviewTransform?.scale || 1;
    const worldTol = CONFIG.CROP_HIT_TOLERANCE / scale;
    let changed = false;
    for (const ci of cropItems) {
        if ((selectionMode === 'hide' && !cropSelectedItemIds.has(ci.id)) || (selectionMode === 'show' && cropSelectedItemIds.has(ci.id))) continue;
        if (pointNearItem(worldX, worldY, ci, worldTol)) {
            const ids = cropSeqnoToIds[ci.seqno]; // <-- Sß╗¡ dß╗Ñng crop map
            const allSelected = ids.every(id => cropSelectedItemIds.has(id));
            if ((selectionMode === 'hide' && allSelected) || (selectionMode === 'show' && !allSelected)) {
                ids.forEach(id => selectionMode === 'hide' ? cropSelectedItemIds.delete(id) : cropSelectedItemIds.add(id));
                changed = true;
            }
            break;
        }
    }
    if (changed) {
        isApplyingSavedPattern = false; // Manual crop resets this flag
        recomputeAnchorBboxFromSelection();
        recomputeCropDataFromSelection();
        redrawActiveCropPreview();
        updateCommandCountSummary();
    }
}

// Crop & Similarity
function recomputeMainLayersFromSelection() {
    const layerSet = new Set(cropItems.filter(ci => cropSelectedItemIds.has(ci.id)).map(ci => ci.layer));
    mainLayers = Array.from(layerSet);
    // Do not change user's layer visibility here. mainLayers is used for internal filtering only.
    scheduleDraw();
}
function recomputeAnchorBboxFromSelection() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const selectedObjSet = new Set(cropItems.filter(ci => cropSelectedItemIds.has(ci.id)).map(ci => ci.obj));
    selectedObjSet.forEach(obj => {
        if (!obj.rect) return;
        const [x1, y1, x2, y2] = obj.rect;
        minX = Math.min(minX, x1); minY = Math.min(minY, y1);
        maxX = Math.max(maxX, x2); maxY = Math.max(maxY, y2);
    });
    if (minX === Infinity) {
        anchorBbox = null;
        searchBboxSize = null;
        return;
    }
    const padding = CONFIG.TIGHT_BBOX_PADDING_RATIO;
    anchorBbox = { x: minX - padding, y: minY - padding, width: (maxX - minX) + 2 * padding, height: (maxY - minY) + 2 * padding };
    searchBboxSize = { width: anchorBbox.width, height: anchorBbox.height };
}
function updateCommandCountSummary() {
    const commandCount = document.getElementById('command-count');
    if (!commandCount) return;
    const countsSel = { l: 0, c: 0, qu: 0 };
    cropItems.forEach(ci => { if (cropSelectedItemIds.has(ci.id)) countsSel[ci.type]++; });
    commandCount.querySelector('[data-summary]')?.remove();
    const summary = document.createElement('li');
    summary.setAttribute('data-summary', '');
    summary.innerHTML = `<strong>Selected:</strong> l=${countsSel.l}, c=${countsSel.c}, qu=${countsSel.qu} / Total=${cropItems.length}`;
    commandCount.insertBefore(summary, commandCount.firstChild);
}

function recomputeCropDataFromSelection() {
    cropLengthsFull = { l: [], c: [], qu: [] };
    cropLengthsFiltered = { l: [], c: [], qu: [] };
    cropLengths = null;
    anchorPatterns = [];
    rawAnchorPatternCount = 0;
    sequencePatternTokens = null;
    if (!anchorBbox) return;
    cropItems.forEach(ci => {
        if (!cropSelectedItemIds.has(ci.id)) return;
        cropLengthsFull[ci.type].push(ci.length);
        const relX = (ci.anchorX - anchorBbox.x) / anchorBbox.width;
        const relY = (ci.anchorY - anchorBbox.y) / anchorBbox.height;
        anchorPatterns.push({ type: ci.type, relX, relY, length: ci.length });
    });
    rawAnchorPatternCount = anchorPatterns.length;
    anchorPatterns = reduceAnchorPatterns(anchorPatterns, CONFIG.MAX_ANCHOR_PATTERNS);
    cropLengthsFiltered = { l: [], c: [], qu: [] };
    for (const t in cropLengthsFull) {
        cropLengthsFiltered[t] = [...cropLengthsFull[t]].sort((a, b) => b - a).slice(0, CONFIG.MAX_COMMANDS_PER_TYPE);
    }
    cropLengths = cropLengthsFiltered;
    // Sau khi cß║¡p nhß║¡t selection, dß╗▒ng sequence pattern tokens.
    buildSequencePatternTokens();
}
function reduceAnchorPatterns(patterns, maxCount) {
    if (!patterns?.length) return [];
    patterns.sort((a, b) => b.length - a.length);
    return patterns.slice(0, maxCount);
}
function checkBboxSimilarityOptimized(testBbox, layerObjIndexMap2) {
    const objectsInBbox = [];
    for (let i = 0; i < mainLayers.length; i++) {
        const layerName = mainLayers[i];
        if (!layerVisibility[layerName]) continue;
        const layerArr = layerIndex[layerName];
        if (!layerArr) continue;
        for (let j = 0; j < layerArr.length; j++) {
            const obj = layerArr[j];
            if (obj.type === 'text' || !obj.rect || !obj.items) continue;
            if (bboxInside(obj.rect, [testBbox.x, testBbox.y, testBbox.x + testBbox.width, testBbox.y + testBbox.height])) {
                objectsInBbox.push({ obj, objIndex: j, layer: layerName });
            }
        }
    }
    if (!objectsInBbox.length) return false;
    const testLengths = { l: [], c: [], qu: [] };
    const tolerance = CONFIG.SIMILARITY_TOLERANCE;
    const requiredCounts = { l: cropLengthsFull.l.length, c: cropLengthsFull.c.length, qu: cropLengthsFull.qu.length };
    for (let i = 0; i < objectsInBbox.length; i++) {
        const { obj, objIndex, layer } = objectsInBbox[i];
        const realIndex = layerObjIndexMap2[layer]?.get(obj);
        for (let j = 0; j < obj.items.length; j++) {
            const item = obj.items[j];
            const type = item[0];
            if (!testLengths.hasOwnProperty(type)) continue;
            // Lazy compute
            const length = getOrComputeLength(layer, objIndex, j, type, item);
            testLengths[type].push(length);
        }
        if (testLengths.l.length >= requiredCounts.l &&
            testLengths.c.length >= requiredCounts.c &&
            testLengths.qu.length >= requiredCounts.qu) {
            break;
        }
    }
    if (testLengths.l.length < Math.ceil(requiredCounts.l * CONFIG.MIN_MATCHING_ITEMS_RATIO) ||
        testLengths.c.length < Math.ceil(requiredCounts.c * CONFIG.MIN_MATCHING_ITEMS_RATIO) ||
        testLengths.qu.length < Math.ceil(requiredCounts.qu * CONFIG.MIN_MATCHING_ITEMS_RATIO)) {
        return 0;
    }
    const totalTestCommands = testLengths.l.length + testLengths.c.length + testLengths.qu.length;
    const totalRequiredCommands = requiredCounts.l + requiredCounts.c + requiredCounts.qu;
    let similarityScore = totalTestCommands / totalRequiredCommands;
    if (similarityScore > 1) {
        similarityScore = totalRequiredCommands / totalTestCommands;
    }
    for (const type in cropLengthsFiltered) {
        if (!cropLengthsFiltered[type].length) continue;
        const uniqueCropLengths = [...new Set(cropLengthsFiltered[type])];
        for (let i = 0; i < uniqueCropLengths.length; i++) {
            const cropLen = uniqueCropLengths[i];
            const cropCount = cropLengthsFiltered[type].filter(len => Math.abs(len - cropLen) <= 0.001).length;
            let testCount = 0;
            for (let j = 0; j < testLengths[type].length; j++) {
                if (Math.abs(testLengths[type][j] - cropLen) <= tolerance) {
                    testCount++;
                }
            }
            if (testCount < cropCount) return similarityScore * 0.5;
        }
    }
    return similarityScore;
}
function buildSequencePatternTokens() {
    sequencePatternTokens = null;
    if (!cropItems.length) return;
    // Lß║Ñy c├íc obj ─æ╞░ß╗úc chß╗ìn trong anchorBbox (d├╣ng seqno ─æß╗â tß║ío chuß╗ùi)
    const selectedBySeq = {};
    cropItems.forEach(ci => {
        if (!cropSelectedItemIds.has(ci.id)) return;
        selectedBySeq[ci.seqno] ??= { l: 0, c: 0, qu: 0, lengths: [] };
        selectedBySeq[ci.seqno][ci.type]++;
        selectedBySeq[ci.seqno].lengths.push(ci.length);
    });
    let seqnos = Object.keys(selectedBySeq).map(n => parseInt(n, 10)).sort((a, b) => a - b);
    if (!seqnos.length) return;

    const gaps = [];
    for (let i = 1; i < seqnos.length; i++) {
        gaps.push(seqnos[i] - seqnos[i - 1]);
    }

    sequencePatternTokens = {
        type: 'gapped',
        seqnos: seqnos,
        gaps: gaps,
        tokens: seqnos.map(s => {
            const counts = selectedBySeq[s];
            const tokenParts = [];
            if (counts.l) tokenParts.push(counts.l + 'l');
            if (counts.c) tokenParts.push(counts.c + 'c');
            if (counts.qu) tokenParts.push(counts.qu + 'q');
            return tokenParts.join('');
        }),
        lengths: seqnos.map(s => selectedBySeq[s].lengths) // l╞░u ─æß╗Ö d├ái c├íc lß╗çnh
    };
}

function findSimilarSequencePatternMatches() {
    sequenceMatches = [];
    if (!sequencePatternTokens || !sequencePatternTokens.tokens?.length || !mainLayers?.length) return;
    const t0 = performance.now();

    // Dß╗▒ng token list to├án cß╗Ñc theo thß╗⌐ tß╗▒ seqno, chß╗ë tr├¬n mainLayers.
    // Use allShapesSorted which is already sorted by seqno
    const globalObjs = allShapesSorted.filter(obj => mainLayers.includes(obj.layer) && obj.seqno != null)
        .map(o => ({ obj: o, seqno: o.seqno }));

    const globalTokens = globalObjs.map(g => {
        const counts = { l: 0, c: 0, qu: 0 };
        if (g.obj.items) g.obj.items.forEach(item => { const t = item[0]; if (counts[t] != null) counts[t]++; });
        const parts = []; if (counts.l) parts.push(counts.l + 'l'); if (counts.c) parts.push(counts.c + 'c'); if (counts.qu) parts.push(counts.qu + 'q');
        g.token = parts.join('');
        return g.token;
    });

    const patternTokens = sequencePatternTokens.tokens;
    const patternGaps = sequencePatternTokens.gaps;
    const patLen = patternTokens.length;

    if (patLen === 1) {
        // Tr╞░ß╗¥ng hß╗úp ─æß║╖c biß╗çt: chß╗ë c├│ 1 token, t├¼m tß║Ñt cß║ú match
        for (let i = 0; i < globalTokens.length; i++) {
            if (globalTokens[i] === patternTokens[0]) {
                let lengthsMatch = true;
                let totalDiff = 0;
                let totalCount = 0;

                // Kiß╗âm tra ─æß╗Ö d├ái lß╗çnh vß╗¢i sai lß╗çch cho pattern 1 token
                const expectedLengths = sequencePatternTokens.lengths[0];
                const actualObj = globalObjs[i].obj;

                if (actualObj.items) {
                    // Lß║Ñy ─æß╗Ö d├ái c├íc lß╗çnh cß╗ºa object hiß╗çn tß║íi
                    const actualLengths = actualObj.items
                        .filter(item => ['l', 'c', 'qu'].includes(item[0]))
                        .map(item => calculateLength(item[0], item))
                        .sort((a, b) => a - b);

                    // So s├ính ─æß╗Ö d├ái vß╗¢i sai lß╗çch cho ph├⌐p
                    if (expectedLengths.length !== actualLengths.length) {
                        lengthsMatch = false;
                    } else {
                        for (let j = 0; j < expectedLengths.length; j++) {
                            const diff = Math.abs(expectedLengths[j] - actualLengths[j]);
                            if (diff > CONFIG.SIMILARITY_TOLERANCE) {
                                lengthsMatch = false;
                                break;
                            }
                            totalDiff += diff;
                            totalCount++;
                        }
                    }
                }

                if (!lengthsMatch) continue;

                const obj = globalObjs[i].obj;
                if (!obj.rect) continue;
                const [x1, y1, x2, y2] = obj.rect;
                const rect = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };

                // ─Éß║┐m sß╗æ lß╗çnh l v├á c trong object t├¼m ─æ╞░ß╗úc
                let foundL = 0, foundC = 0;
                if (obj.items) {
                    obj.items.forEach(item => {
                        if (item[0] === 'l') foundL++;
                        else if (item[0] === 'c') foundC++;
                    });
                }

                // T├¡nh score dß╗▒a tr├¬n sß╗æ l╞░ß╗úng lß╗çnh l,c t├¼m ─æ╞░ß╗úc so vß╗¢i bbox gß╗æc
                const expectedL = cropLengthsFull.l.length;
                const expectedC = cropLengthsFull.c.length;
                const totalExpected = expectedL + expectedC;
                const totalFound = foundL + foundC;
                let score = totalExpected > 0 ? Math.min(1.0, totalFound / totalExpected) : 1.0;

                if (score >= CONFIG.SIMILARITY_THRESHOLD_PURPLE) {
                    sequenceMatches.push({ rect, startSeqno: globalObjs[i].seqno, endSeqno: globalObjs[i].seqno, score });
                }
            }
        }
    } else {
        // Logic mß╗¢i: t├¼m pattern vß╗¢i khoß║úng c├ích t╞░╞íng tß╗▒ bß║▒ng Map dictionary
        const seqnoMap = new Map();
        for (let i = 0; i < globalObjs.length; i++) {
            const g = globalObjs[i];
            seqnoMap.set(g.seqno, g); // globalObjs contains {obj, seqno, token}
        }

        for (let i = 0; i < globalObjs.length; i++) {
            const startObj = globalObjs[i];

            let matchObjList = [startObj];
            let currentSeqno = startObj.seqno;
            // Bß╗Å qua strict tokensMatch: cho ph├⌐p match "mß╗üm" dß╗▒a v├áo ─æiß╗âm score

            for (let k = 1; k < patLen; k++) {
                currentSeqno += patternGaps[k - 1];
                const nextObj = seqnoMap.get(currentSeqno);
                if (!nextObj) {
                    // Nß║┐u khuyß║┐t thiß║┐u obj tß║íi khoß║úng gap n├áy th├¼ cß╗⌐ push tß║ím obj trß╗æng ─æß╗â l├ám nß╗ün t├¡nh ─æiß╗âm
                    matchObjList.push({ obj: { items: [], rect: null }, seqno: currentSeqno, token: '' });
                } else {
                    matchObjList.push(nextObj);
                }
            }

            // T├¡nh rect chß║╖t cho window
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (let k = 0; k < patLen; k++) {
                const b = matchObjList[k].obj.rect;
                if (!b) continue;
                minX = Math.min(minX, b[0]); minY = Math.min(minY, b[1]);
                maxX = Math.max(maxX, b[2]); maxY = Math.max(maxY, b[3]);
            }
            if (minX === Infinity) continue;

            const width = maxX - minX;
            const height = maxY - minY;
            
            // Diagonal-based filtering (optimal rotation-invariant constraint)
            // Mathematical guarantee: max(rotated_width, rotated_height) <= original_diagonal
            // Pure geometric constraint, no threshold multiplier needed!
            if (searchBboxSize) {
                const anchorDiagonal = Math.sqrt(
                    searchBboxSize.width ** 2 + searchBboxSize.height ** 2
                );
                const maxSide = Math.max(width, height);
                if (maxSide > anchorDiagonal) {
                    continue;
                }
            }

            const rect = { x: minX, y: minY, width, height };

            // ─Éß║┐m sß╗æ lß╗çnh l v├á c trong c├íc object t├¼m ─æ╞░ß╗úc (kß║┐t hß╗úp kiß╗âm tra khß╗¢p ─æß╗Ö d├ái)
            let foundL = 0, foundC = 0;
            for (let k = 0; k < patLen; k++) {
                const matchItem = matchObjList[k];
                const actualObj = matchItem.obj;
                if (!actualObj.items) continue; // Khuyß║┐t object

                // 1. Kiß╗âm tra khß╗¢p lß╗çnh vß║╜ (v├¡ dß╗Ñ: 3l) - nß║┐u kh├íc lß╗çnh vß║╜ coi nh╞░ mß║únh n├áy 0 ─æiß╗âm
                if (matchItem.token !== patternTokens[k]) {
                    continue;
                }

                // 2. T├¡nh ─æiß╗âm ─æß╗Ö d├ái tß╗½ng lß╗çnh (khß╗¢p ho├án to├án ─æß╗Ö d├ái = 1─æ, lß╗çch ─æß╗Ö d├ái = 0.5─æ)
                const expectedLengths = [...sequencePatternTokens.lengths[k]];

                actualObj.items.forEach(item => {
                    const type = item[0];
                    if (type === 'l' || type === 'c') {
                        const len = calculateLength(type, item);
                        let matchedIdx = -1;
                        let minDiff = Infinity;
                        for (let j = 0; j < expectedLengths.length; j++) {
                            const diff = Math.abs(expectedLengths[j] - len);
                            if (diff <= CONFIG.SIMILARITY_TOLERANCE && diff < minDiff) {
                                minDiff = diff;
                                matchedIdx = j;
                            }
                        }

                        let multiplier = 0.5; // Kh├íc ─æß╗Ö d├ái -> 0.5 ─æiß╗âm
                        if (matchedIdx !== -1) {
                            multiplier = 1.0; // Khß╗¢p ─æß╗Ö d├ái -> 1.0 ─æiß╗âm
                            expectedLengths.splice(matchedIdx, 1);
                        }

                        if (type === 'l') foundL += multiplier;
                        else if (type === 'c') foundC += multiplier;
                    }
                });
            }

            // T├¡nh score dß╗▒a tr├¬n sß╗æ l╞░ß╗úng lß╗çnh l,c t├¼m ─æ╞░ß╗úc so vß╗¢i bbox gß╗æc
            const expectedL = cropLengthsFull.l.length;
            const expectedC = cropLengthsFull.c.length;
            const totalExpected = expectedL + expectedC;
            const totalFound = foundL + foundC;
            let score = totalExpected > 0 ? Math.min(1.0, totalFound / totalExpected) : 1.0;

            if (score >= CONFIG.SIMILARITY_THRESHOLD_PURPLE) {
                sequenceMatches.push({ rect, startSeqno: matchObjList[0].seqno, endSeqno: matchObjList[patLen - 1].seqno, score });
            }
        }
    }

    // Filter overlaps > 20% (matching Python logic)
    const filteredMatches = [];
    sequenceMatches.sort((a, b) => b.score - a.score); // Sort by score desc first
    for (const match of sequenceMatches) {
        let isOverlap = false;
        for (const existing of filteredMatches) {
            if (bboxOverlapPercentage(match.rect, existing.rect) > 20) {
                isOverlap = true;
                break;
            }
        }
        if (!isOverlap) {
            filteredMatches.push(match);
        }
    }
    sequenceMatches = filteredMatches;

    lastSequenceSearchMs = performance.now() - t0;
}

function findSimilarRegions() {
    if (!hasRenderableDocument() || !cropLengths || !searchBboxSize) return;

    // 1. Run Purple Logic FIRST
    findSimilarSequencePatternMatches();

    similarBboxes = [];
    if (!anchorPatterns?.length) {
        console.warn('Kh├┤ng c├│ anchorPatterns ─æß╗â so s├ính.');
        // If no anchor patterns, we can't run green logic, but we might have purple results.
        // We should proceed to update UI.
    } else {
        const t0 = performance.now();
        let candidateCount = 0, timeoutExceeded = false;
        const globalLayerObjIndexMap = {};
        for (let i = 0; i < mainLayers.length; i++) {
            const layerName = mainLayers[i];
            const arr = layerIndex[layerName] || [];
            globalLayerObjIndexMap[layerName] = new Map(arr.map((o, idx) => [o, idx]));
        }
        const patternsByType = { l: [], c: [], qu: [] };
        for (let i = 0; i < anchorPatterns.length; i++) {
            const pattern = anchorPatterns[i];
            if (patternsByType[pattern.type]) {
                patternsByType[pattern.type].push(pattern);
            }
        }
        const checkedBboxes = new Set();
        for (let layerIdx = 0; layerIdx < sortedLayerKeys.length; layerIdx++) {
            const layerName = sortedLayerKeys[layerIdx];
            // Search should consider internal mainLayers regardless of what user has toggled visually.
            if (!mainLayers.includes(layerName)) continue;
            const arr = layerIndex[layerName] || [];
            for (let objIndex = 0; objIndex < arr.length; objIndex++) {
                const obj = arr[objIndex];
                if (obj.type === 'text' || !obj.items) continue;
                for (let itemIndex = 0; itemIndex < obj.items.length; itemIndex++) {
                    if (candidateCount % 200 === 0 && performance.now() - t0 > CONFIG.TIMEOUT_MS) {
                        timeoutExceeded = true;
                        break;
                    }
                    const item = obj.items[itemIndex];
                    const commandType = item[0];
                    if (commandType !== 'l' && commandType !== 'c' && commandType !== 'qu') continue;
                    
                    // Get relevant patterns for this command type
                    const relevantPatterns = patternsByType[commandType] || [];
                    if (relevantPatterns.length === 0) continue;
                    
                    const commandLength = precomputedLengths[layerName]?.[objIndex]?.[itemIndex] || calculateLength(commandType, item);
                    let anchorX, anchorY;
                    if (commandType === 'l' || commandType === 'c') {
                        [anchorX, anchorY] = item[1];
                    } else if (commandType === 'qu') {
                        const points = item[1];
                        if (points?.length) {
                            [anchorX, anchorY] = points[0];
                        } else {
                            continue;
                        }
                    }
                    for (let patternIdx = 0; patternIdx < relevantPatterns.length; patternIdx++) {
                        const pattern = relevantPatterns[patternIdx];
                        if (Math.abs(pattern.length - commandLength) > CONFIG.SIMILARITY_TOLERANCE) continue;
                        candidateCount++;
                        // 8 unique rotations/reflections (dihedral group D4)
                        const rotations = [
                            { relX: pattern.relX, relY: pattern.relY, width: searchBboxSize.width, height: searchBboxSize.height },
                            { relX: 1 - pattern.relY, relY: pattern.relX, width: searchBboxSize.height, height: searchBboxSize.width },
                            { relX: 1 - pattern.relX, relY: 1 - pattern.relY, width: searchBboxSize.width, height: searchBboxSize.height },
                            { relX: pattern.relY, relY: 1 - pattern.relX, width: searchBboxSize.height, height: searchBboxSize.width },
                            { relX: 1 - pattern.relX, relY: pattern.relY, width: searchBboxSize.width, height: searchBboxSize.height },
                            { relX: pattern.relX, relY: 1 - pattern.relY, width: searchBboxSize.width, height: searchBboxSize.height },
                            { relX: pattern.relY, relY: pattern.relX, width: searchBboxSize.height, height: searchBboxSize.width },
                            { relX: 1 - pattern.relY, relY: 1 - pattern.relX, width: searchBboxSize.height, height: searchBboxSize.width }
                        ];
                        for (let rotIdx = 0; rotIdx < rotations.length; rotIdx++) {
                            const rotatedPattern = rotations[rotIdx];
                            const testBbox = {
                                x: anchorX - rotatedPattern.relX * rotatedPattern.width,
                                y: anchorY - rotatedPattern.relY * rotatedPattern.height,
                                width: rotatedPattern.width,
                                height: rotatedPattern.height
                            };
                            const bboxKey = `${Math.round(testBbox.x * 10)},${Math.round(testBbox.y * 10)},${Math.round(testBbox.width * 10)},${Math.round(testBbox.height * 10)}`;
                            if (checkedBboxes.has(bboxKey)) continue;
                            checkedBboxes.add(bboxKey);
                            const score = checkBboxSimilarityOptimized(testBbox, globalLayerObjIndexMap);
                            if (score >= CONFIG.SIMILARITY_THRESHOLD_GREEN) {
                                let tightMinX = Infinity, tightMinY = Infinity, tightMaxX = -Infinity, tightMaxY = -Infinity;
                                for (let i = 0; i < sortedLayerKeys.length; i++) {
                                    const layerName2 = sortedLayerKeys[i];
                                    if (!mainLayers.includes(layerName2)) continue;
                                    const layerArr = layerIndex[layerName2] || [];
                                    for (let j = 0; j < layerArr.length; j++) {
                                        const obj2 = layerArr[j];
                                        if (!obj2.rect) continue;
                                        if (bboxInside(obj2.rect, [testBbox.x, testBbox.y, testBbox.x + testBbox.width, testBbox.y + testBbox.height])) {
                                            const [x1, y1, x2, y2] = obj2.rect;
                                            if (x1 < tightMinX) tightMinX = x1;
                                            if (y1 < tightMinY) tightMinY = y1;
                                            if (x2 > tightMaxX) tightMaxX = x2;
                                            if (y2 > tightMaxY) tightMaxY = y2;
                                        }
                                    }
                                }
                                if (tightMinX !== Infinity) {
                                    similarBboxes.push({ x: tightMinX, y: tightMinY, width: tightMaxX - tightMinX, height: tightMaxY - tightMinY, score });
                                }
                            }
                        }
                    }
                }
                if (timeoutExceeded) break;
            }
            if (timeoutExceeded) break;
        }
        lastSearchMs = performance.now() - t0;
        console.log(`Anchor patterns (reduced): ${anchorPatterns.length} / raw ${rawAnchorPatternCount}, candidates tested: ${candidateCount}, similar found before filter: ${similarBboxes.length}, time: ${lastSearchMs.toFixed(0)} ms`);
        similarBboxes.sort((a, b) => b.score - a.score);
        similarBboxes = similarBboxes.filter((rect, idx, arr) => {
            for (let i = 0; i < idx; i++) {
                if (bboxOverlapPercentage(rect, arr[i]) > 20) {
                    return false;
                }
            }
            return true;
        });
        console.log(`Similar found after filter: ${similarBboxes.length}`);

        if (timeoutExceeded) {
            alert(`Error: Search timed out after ${CONFIG.TIMEOUT_MS / 1000} seconds due to complexity. Search stopped.`);
        }
    }

    // Merge Logic
    if (CONFIG.MERGE_RESULTS && sequenceMatches && sequenceMatches.length > 0 && similarBboxes.length > 0) {
        const initialPurpleCount = sequenceMatches.length;
        sequenceMatches = sequenceMatches.filter(purpleBox => {
            // Check if this purple box overlaps with any green box > 50% (overlap / smaller_area)
            const overlapsGreen = similarBboxes.some(greenBox => {
                const overlapPct = bboxOverlapPercentage(purpleBox.rect, greenBox);
                return overlapPct > 50;
            });
            // If overlaps, remove it (return false), otherwise keep it (return true)
            return !overlapsGreen;
        });
        console.log(`Merged results: Removed ${initialPurpleCount - sequenceMatches.length} purple boxes overlapping with green boxes.`);
    }

    const foundCountDiv = document.getElementById('found-count');
    if (!foundCountDiv) {
        console.error('found-count element not found!');
        return;
    }
    let totalFound = similarBboxes.length + (sequenceMatches ? sequenceMatches.length : 0);
    console.log('Total found:', totalFound, 'similarBboxes:', similarBboxes.length, 'sequenceMatches:', sequenceMatches ? sequenceMatches.length : 0);
    if (totalFound > 0) {
        let msg;
        if (CONFIG.MERGE_RESULTS) {
            msg = `Found ${totalFound} in ${((lastSearchMs + lastSequenceSearchMs) / 1000).toFixed(2)}s`;
        } else {
            msg = `Found ${similarBboxes.length} (green) in ${(lastSearchMs / 1000).toFixed(2)}s`;
            if (sequenceMatches && sequenceMatches.length > 0) {
                msg += `, ${sequenceMatches.length} (purple) in ${(lastSequenceSearchMs / 1000).toFixed(2)}s`;
            }
        }
        foundCountDiv.textContent = msg;
        foundCountDiv.style.display = 'block';
    } else {
        // Always show result even if 0 found
        foundCountDiv.textContent = 'Found 0 objects.';
        foundCountDiv.style.display = 'block';
    }
}

async function showCropModal(rect) {
    // FIXED: Kiß╗âm tra size bbox ─æß╗â tr├ính lß╗ùi Infinity khi scale
    if (!rect || !hasRenderableDocument() || rect.width <= 0 || rect.height <= 0) return;
    const cropRect = {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
    };
    const cropRectArray = [cropRect.x, cropRect.y, cropRect.x + cropRect.width, cropRect.y + cropRect.height];
    const prevCropState = {
        cropLengths,
        cropLengthsFull,
        cropLengthsFiltered,
        mainLayers: mainLayers ? [...mainLayers] : null,
        anchorBbox,
        searchBboxSize
    };
    selectionMode = 'hide';
    const modal = document.getElementById('crop-modal');
    const cropCanvas = document.getElementById('crop-canvas');
    const ctx2 = cropCanvas.getContext('2d');
    const commandCount = document.getElementById('command-count');
    const colorContainer = document.getElementById('crop-color-filters');
    const bboxCoords = document.getElementById('rect-coords');
    const btnHideMode = document.getElementById('btn-hide-mode');
    const btnShowMode = document.getElementById('btn-show-mode');
    const btnSearchNow = document.getElementById('btn-search-now');
    const btnCancelSearch = document.getElementById('btn-cancel-search');
    const btnSavePattern = document.getElementById('btn-save-pattern');
    const closeBtn = modal.querySelector('.close');
    const requestId = ++activeCropModalRequestId;
    let cropDataReady = false;
    let activeSavePatternButton = btnSavePattern;

    const isPrepStale = () => requestId !== activeCropModalRequestId;
    const setPreparationState = preparing => {
        btnHideMode.disabled = preparing;
        btnShowMode.disabled = preparing;
        if (btnSearchNow) btnSearchNow.disabled = preparing;
        if (activeSavePatternButton) activeSavePatternButton.disabled = preparing;
    };

    const maybeYieldDuringCropPrep = async count => {
        if (typeof yieldToBrowser !== 'function' || count <= 0 || count % 250 !== 0) {
            return false;
        }
        await yieldToBrowser();
        return isPrepStale();
    };

    btnHideMode.classList.add('active');
    btnShowMode.classList.remove('active');
    cropPreviewBbox = { ...cropRect };
    bboxCoords.textContent = `${cropPreviewBbox.x.toFixed(2)}, ${cropPreviewBbox.y.toFixed(2)}, ${(cropPreviewBbox.x + cropPreviewBbox.width).toFixed(2)}, ${(cropPreviewBbox.y + cropPreviewBbox.height).toFixed(2)}`;
    commandCount.innerHTML = '<li>Preparing selection...</li>';
    colorContainer.innerHTML = '<div style="font-size:12px; color: var(--text-color-secondary);">Collecting objects inside bbox...</div>';
    ctx2.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
    drawCropPreviewRasterPlaceholder(cropCanvas, cropPreviewBbox);
    cropPreviewTransform = null;
    cropItems = [];
    cropSelectedItemIds = new Set();
    cropSeqnoToIds = {};
    isCropModalOpen = true;
    setPreparationState(true);
    modal.style.display = 'block';

    const restoreAndClose = (doSearch) => {
        activeCropModalRequestId += 1;

        const finish = (results) => {
            modal.style.display = 'none';
            closeBtn.onclick = null;
            modal.onclick = null;
            if (btnSearchNow) btnSearchNow.onclick = null;
            if (btnCancelSearch) btnCancelSearch.onclick = null;
            if (activeSavePatternButton) activeSavePatternButton.onclick = null;
            btnHideMode.onclick = null;
            btnShowMode.onclick = null;
            cropCanvas.onmousedown = null;
            cropCanvas.onmouseup = null;
            cropCanvas.onmouseleave = null;
            cropCanvas.onmousemove = null;
            ctx2.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
            colorContainer.innerHTML = '';
            commandCount.innerHTML = '';
            // Restore crop/search state (so canvas no longer filtered by the modal selection)
            cropLengths = prevCropState.cropLengths;
            cropLengthsFull = prevCropState.cropLengthsFull;
            cropLengthsFiltered = prevCropState.cropLengthsFiltered;
            mainLayers = prevCropState.mainLayers;
            anchorBbox = prevCropState.anchorBbox;
            searchBboxSize = prevCropState.searchBboxSize;
            // Set similarBboxes from search results (if any) so overlay remains
            similarBboxes = results || [];
            clearCropModalWorkingSet();
            scheduleDraw();
        };

        if (doSearch) {
            if (!cropDataReady) return;
            if (cropSelectedItemIds.size > 0) {
                // Recalculate mainLayers based on the final selection in the crop modal
                recomputeMainLayersFromSelection();

                // Show blocking overlay then run search so UI is blocked during processing
                const popup = document.getElementById('loading-popup');
                if (popup) popup.style.display = 'flex';
                // allow overlay to render
                setTimeout(() => {
                    try {
                        findSimilarRegions();
                        const results = similarBboxes ? [...similarBboxes] : [];
                        if (popup) popup.style.display = 'none';
                        finish(results);
                    } catch (err) {
                        console.error('Error during search', err);
                        if (popup) popup.style.display = 'none';
                        finish([]);
                    }
                }, 20);
            } else {
                alert(`No items selected${UI_TEXT.EN_DASH_SEPARATOR}skipping search.`);
                finish([]);
            }
        } else {
            // Cancel: don't perform search, restore prior state and clear any temporary similar boxes
            finish([]);
        }
    };

    closeBtn.onclick = () => restoreAndClose(false);
    modal.onclick = event => {
        if (event.target === modal) restoreAndClose(false);
    };

    btnSearchNow.onclick = () => restoreAndClose(true);
    btnCancelSearch.onclick = () => restoreAndClose(false);

    if (btnSavePattern) {
        // Remove old listeners to prevent duplicates if creating new button
        const newBtn = btnSavePattern.cloneNode(true);
        btnSavePattern.parentNode.replaceChild(newBtn, btnSavePattern);
        activeSavePatternButton = newBtn;
        activeSavePatternButton.disabled = true;
        activeSavePatternButton.onclick = () => {
            if (!cropDataReady) return;
            saveCurrentPattern();
        };
    }
    btnHideMode.onclick = () => {
        selectionMode = 'hide';
        btnHideMode.classList.add('active');
        btnShowMode.classList.remove('active');
    };
    btnShowMode.onclick = () => {
        selectionMode = 'show';
        btnShowMode.classList.add('active');
        btnHideMode.classList.remove('active');
    };
    cropCanvas.onmousedown = e => {
        dragSelecting = true;
        const rect = cropCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left, y = e.clientY - rect.top;
        if (!cropPreviewTransform) return;
        const worldX = (x - cropPreviewTransform.offsetX) / cropPreviewTransform.scale + cropPreviewTransform.rect.x;
        const worldY = (y - cropPreviewTransform.offsetY) / cropPreviewTransform.scale + cropPreviewTransform.rect.y;
        applySelectionAtPoint(worldX, worldY);
    };
    cropCanvas.onmouseup = () => {
        dragSelecting = false;
    };
    cropCanvas.onmouseleave = () => {
        dragSelecting = false;
    };
    cropCanvas.onmousemove = e => {
        if (!dragSelecting) return;
        const rect = cropCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left, y = e.clientY - rect.top;
        if (!cropPreviewTransform) return;
        const worldX = (x - cropPreviewTransform.offsetX) / cropPreviewTransform.scale + cropPreviewTransform.rect.x;
        const worldY = (y - cropPreviewTransform.offsetY) / cropPreviewTransform.scale + cropPreviewTransform.rect.y;
        applySelectionAtPoint(worldX, worldY);
    };

    if (typeof yieldToBrowser === 'function') {
        await yieldToBrowser();
    }
    if (isPrepStale()) return;

    const pageCache = await ensureFindPopupPageCache();
    if (isPrepStale()) return;

    const croppedObjs = [];
    const layerSet = new Set();
    const collectIfInsideCrop = obj => {
        const layerName = obj?.layer;
        if (!layerName || !layerVisibility[layerName] || !obj.rect) return;
        if (!bboxInside(obj.rect, cropRectArray)) return;
        croppedObjs.push({ obj, layer: layerName });
        layerSet.add(layerName);
    };

    if (shapeQuadtree) {
        const candidateObjs = shapeQuadtree.query({
            minX: cropRectArray[0],
            minY: cropRectArray[1],
            maxX: cropRectArray[2],
            maxY: cropRectArray[3]
        }, []);
        for (let index = 0; index < candidateObjs.length; index += 1) {
            collectIfInsideCrop(candidateObjs[index]);
            if (await maybeYieldDuringCropPrep(index)) return;
        }
    } else if (allShapesSorted && allShapesSorted.length > 0) {
        for (let index = 0; index < allShapesSorted.length; index += 1) {
            collectIfInsideCrop(allShapesSorted[index]);
            if (await maybeYieldDuringCropPrep(index)) return;
        }
    } else {
        let processed = 0;
        for (let layerIndexPos = 0; layerIndexPos < sortedLayerKeys.length; layerIndexPos += 1) {
            const layerName = sortedLayerKeys[layerIndexPos];
            if (!layerVisibility[layerName]) continue;
            const layerArr = layerIndex[layerName] || [];
            for (let index = 0; index < layerArr.length; index += 1) {
                collectIfInsideCrop(layerArr[index]);
                processed += 1;
                if (await maybeYieldDuringCropPrep(processed)) return;
            }
        }
    }

    if (!croppedObjs.length) {
        restoreAndClose(false);
        return;
    }

    let tightMinX = Infinity, tightMinY = Infinity, tightMaxX = -Infinity, tightMaxY = -Infinity;
    for (let index = 0; index < croppedObjs.length; index += 1) {
        const obj = croppedObjs[index].obj;
        if (!obj.rect) continue;
        const [x1, y1, x2, y2] = obj.rect;
        tightMinX = Math.min(tightMinX, x1);
        tightMinY = Math.min(tightMinY, y1);
        tightMaxX = Math.max(tightMaxX, x2);
        tightMaxY = Math.max(tightMaxY, y2);
        if (await maybeYieldDuringCropPrep(index)) return;
    }
    if (tightMinX === Infinity) {
        tightMinX = cropRect.x;
        tightMinY = cropRect.y;
        tightMaxX = cropRect.x + cropRect.width;
        tightMaxY = cropRect.y + cropRect.height;
    }
    const padding = CONFIG.TIGHT_BBOX_PADDING_RATIO;
    anchorBbox = { x: tightMinX - padding, y: tightMinY - padding, width: (tightMaxX - tightMinX) + 2 * padding, height: (tightMaxY - tightMinY) + 2 * padding };
    const selectedLayerNames = Array.from(layerSet);
    mainLayers = selectedLayerNames;
    searchBboxSize = { width: anchorBbox.width, height: anchorBbox.height };
    cropItems = [];
    const totalCounts = { l: 0, c: 0, qu: 0 };
    let nextId = 0;
    for (let objPos = 0; objPos < croppedObjs.length; objPos += 1) {
        const { obj, layer } = croppedObjs[objPos];
        const cachedMeta = pageCache?.objectMetaByObject?.get(obj) || buildFindPopupObjectMeta(obj, layer, 0);
        if (cachedMeta?.commandCounts) {
            totalCounts.l += cachedMeta.commandCounts.l;
            totalCounts.c += cachedMeta.commandCounts.c;
            totalCounts.qu += cachedMeta.commandCounts.qu;
        }
        if (!cachedMeta?.commands?.length) {
            if (await maybeYieldDuringCropPrep(objPos)) return;
            continue;
        }
        for (let commandPos = 0; commandPos < cachedMeta.commands.length; commandPos += 1) {
            const command = cachedMeta.commands[commandPos];
            cropItems.push({
                id: nextId++,
                type: command.type,
                length: command.length,
                anchorX: command.anchorX,
                anchorY: command.anchorY,
                obj,
                layer,
                objIndex: cachedMeta.objIndex,
                itemIndex: command.itemIndex,
                seqno: cachedMeta.seqno,
                colorStr: cachedMeta.colorStr
            });
        }
        if (await maybeYieldDuringCropPrep(objPos)) return;
    }
    cropSelectedItemIds = new Set(cropItems.map(ci => ci.id));
    isApplyingSavedPattern = false; // Reset flag to show blue box for manual crop

    cropSeqnoToIds = {};
    const colorGroups = {};
    for (let index = 0; index < cropItems.length; index += 1) {
        const ci = cropItems[index];
        cropSeqnoToIds[ci.seqno] ??= [];
        cropSeqnoToIds[ci.seqno].push(ci.id);

        const colorStr = ci.colorStr || 'rgba(0, 0, 0, 1)';
        if (!colorGroups[colorStr]) {
            colorGroups[colorStr] = { count: 0, items: [] };
        }
        colorGroups[colorStr].count++;
        colorGroups[colorStr].items.push(ci);
        if (await maybeYieldDuringCropPrep(index)) return;
    }

    colorContainer.innerHTML = '';
    Object.entries(colorGroups).forEach(([colorStr, group]) => {
        const label = document.createElement('label');
        label.style.display = 'flex';
        label.style.alignItems = 'center';
        label.style.cursor = 'pointer';
        label.style.fontSize = '12px';
        label.style.marginBottom = '4px';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        checkbox.dataset.color = colorStr;
        checkbox.style.marginRight = '8px';
        checkbox.style.cursor = 'pointer';

        const swatch = document.createElement('div');
        swatch.style.width = '14px';
        swatch.style.height = '14px';
        swatch.style.backgroundColor = colorStr;
        swatch.style.border = '1px solid var(--border-color-dark)';
        swatch.style.marginRight = '8px';
        swatch.style.borderRadius = '3px';

        const text = document.createElement('span');
        text.textContent = `${colorStr} (${group.count})`;

        checkbox.addEventListener('change', e => {
            const isChecked = e.target.checked;
            let changed = false;
            group.items.forEach(ci => {
                const ids = cropSeqnoToIds[ci.seqno];
                if (ids) {
                    ids.forEach(id => {
                        if (isChecked) {
                            if (!cropSelectedItemIds.has(id)) {
                                cropSelectedItemIds.add(id);
                                changed = true;
                            }
                        } else {
                            if (cropSelectedItemIds.has(id)) {
                                cropSelectedItemIds.delete(id);
                                changed = true;
                            }
                        }
                    });
                }
            });

            if (changed) {
                isApplyingSavedPattern = false;
                recomputeAnchorBboxFromSelection();
                recomputeCropDataFromSelection();
                redrawActiveCropPreview();
                updateCommandCountSummary();
            }
        });

        label.appendChild(checkbox);
        label.appendChild(swatch);
        label.appendChild(text);
        colorContainer.appendChild(label);
    });

    recomputeCropDataFromSelection();
    const displayLengths = {};
    for (const type in cropLengthsFull) displayLengths[type] = [...new Set(cropLengthsFull[type])].sort((a, b) => a - b);
    commandCount.innerHTML = `<li><strong>Total (within region):</strong> l=${totalCounts.l}, c=${totalCounts.c}, qu=${totalCounts.qu}</li>
    ${displayLengths.l.length ? `<li>l lengths: ${getDisplayLengths(displayLengths.l)}</li>` : ''}
    ${displayLengths.c.length ? `<li>c lengths: ${getDisplayLengths(displayLengths.c)}</li>` : ''}
    ${displayLengths.qu.length ? `<li>qu lengths: ${getDisplayLengths(displayLengths.qu)}</li>` : ''}
    <li style='margin-top:6px;list-style:none;'><em>Hold left mouse and hover over strokes to hide/show.</em></li>`;

    // Hiß╗ân thß╗ï sequence pattern nß║┐u c├│
    if (sequencePatternTokens?.tokens?.length) {
        const li = document.createElement('li');
        li.style.listStyle = 'none';
        const seqnos = sequencePatternTokens.seqnos.join(', ');
        const type = sequencePatternTokens.type === 'consecutive' ? 'consecutive' : 'gapped';
        const gaps = sequencePatternTokens.gaps.length ? ` (gaps: ${sequencePatternTokens.gaps.join(', ')})` : '';
        const tokens = sequencePatternTokens.tokens.join(' ');
        const lengthCheck = sequencePatternTokens.tokens.length < 5 ? ' (length check)' : '';
        li.innerHTML = `<strong>Pattern ${type}:</strong> [${seqnos}]${gaps}<br><strong>Tokens:</strong> ${tokens} (len ${sequencePatternTokens.tokens.length})${lengthCheck}`;
        commandCount.appendChild(li);
    }
    ctx2.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
    const scaleX = cropCanvas.width / cropPreviewBbox.width;
    const scaleY = cropCanvas.height / cropPreviewBbox.height;
    const scale = Math.min(scaleX, scaleY);
    const offsetX2 = (cropCanvas.width - cropPreviewBbox.width * scale) / 2;
    const offsetY2 = (cropCanvas.height - cropPreviewBbox.height * scale) / 2;
    cropPreviewTransform = { scale, offsetX: offsetX2, offsetY: offsetY2, rect: cropPreviewBbox };
    rebuildCropPreviewLookup(croppedObjs);
    redrawCropPreview(ctx2, croppedObjs, cropPreviewBbox, cropCanvas);
    cropDataReady = true;
    setPreparationState(false);
    updateCommandCountSummary();
}