// streaming_parser.js
function normalizeShapeForViewer(rawShape, id) {
    const seqnoValue = Number.isFinite(rawShape?.seqno)
        ? rawShape.seqno
        : (Number.parseInt(rawShape?.seqno, 10) || 0);
    const shape = {
        id,
        type: rawShape?.type || null,
        layer: typeof rawShape?.layer === 'string' ? rawShape.layer : '',
        layer_1: typeof rawShape?.layer_1 === 'string' ? rawShape.layer_1 : '',
        source_layer: typeof rawShape?.layer === 'string' ? rawShape.layer : '',
        source_layer_1: typeof rawShape?.layer_1 === 'string' ? rawShape.layer_1 : '',
        items: Array.isArray(rawShape?.items) ? rawShape.items : null,
        color: rawShape?.color ?? null,
        width: rawShape?.width,
        fill: rawShape?.fill ?? null,
        rect: Array.isArray(rawShape?.rect) ? rawShape.rect : null,
        seqno: seqnoValue
    };
    if (rawShape?.bbox && Number.isFinite(rawShape.bbox.minX) && Number.isFinite(rawShape.bbox.minY) && Number.isFinite(rawShape.bbox.maxX) && Number.isFinite(rawShape.bbox.maxY)) {
        shape.bbox = {
            minX: rawShape.bbox.minX,
            minY: rawShape.bbox.minY,
            maxX: rawShape.bbox.maxX,
            maxY: rawShape.bbox.maxY
        };
    } else if (!setShapeBboxFromRect(shape) && shape.items) {
        computeShapeBbox(shape);
    }
    return shape;
}

function normalizeShapesArray(rawShapes) {
    const shapes = new Array(rawShapes.length);
    for (let index = 0; index < rawShapes.length; index += 1) {
        shapes[index] = normalizeShapeForViewer(rawShapes[index], index);
    }
    return shapes;
}

function getRasterPreviewBoundsFromMetadata(metadata) {
    if (!metadata || !Array.isArray(metadata.bbox_all) || metadata.bbox_all.length !== 4) {
        return null;
    }

    const [minX, minY, maxX, maxY] = metadata.bbox_all;
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
        return null;
    }

    return {
        minX,
        minY,
        maxX,
        maxY,
        width: Math.max(1, maxX - minX),
        height: Math.max(1, maxY - minY)
    };
}

function getRasterPreviewBoundsForShape(shape) {
    if (shape?.bbox) {
        return {
            minX: shape.bbox.minX,
            minY: shape.bbox.minY,
            maxX: shape.bbox.maxX,
            maxY: shape.bbox.maxY,
            width: Math.max(1, shape.bbox.maxX - shape.bbox.minX),
            height: Math.max(1, shape.bbox.maxY - shape.bbox.minY)
        };
    }

    if (Array.isArray(shape?.rect) && shape.rect.length === 4) {
        const [minX, minY, maxX, maxY] = shape.rect;
        if ([minX, minY, maxX, maxY].every(Number.isFinite)) {
            return {
                minX,
                minY,
                maxX,
                maxY,
                width: Math.max(1, maxX - minX),
                height: Math.max(1, maxY - minY)
            };
        }
    }

    return null;
}

function mergeRasterPreviewBounds(currentBounds, nextBounds) {
    if (!currentBounds) return nextBounds;
    if (!nextBounds) return currentBounds;

    const minX = Math.min(currentBounds.minX, nextBounds.minX);
    const minY = Math.min(currentBounds.minY, nextBounds.minY);
    const maxX = Math.max(currentBounds.maxX, nextBounds.maxX);
    const maxY = Math.max(currentBounds.maxY, nextBounds.maxY);

    return {
        minX,
        minY,
        maxX,
        maxY,
        width: Math.max(1, maxX - minX),
        height: Math.max(1, maxY - minY)
    };
}

function getRasterPreviewScale(bounds, targetScale = 1) {
    const maxSide = 12288;
    const maxPixels = 72 * 1024 * 1024;

    const sideScale = Math.min(targetScale, maxSide / bounds.width, maxSide / bounds.height);
    const pixelScale = Math.min(targetScale, Math.sqrt(maxPixels / (bounds.width * bounds.height)));
    return Math.max(0.01, Math.min(targetScale, sideScale, pixelScale));
}

function createStreamingShapeRasterBuilder(targetScale = 1) {
    if (typeof document === 'undefined' || typeof drawShapeOnCtx !== 'function') {
        return null;
    }

    let bounds = null;
    let scale = 1;
    let rasterCanvas = null;
    let rasterCtx = null;

    function ensureCanvas(nextBounds) {
        const mergedBounds = mergeRasterPreviewBounds(bounds, nextBounds);
        if (!mergedBounds) return false;

        const nextScale = getRasterPreviewScale(mergedBounds, targetScale);
        const nextWidth = Math.max(1, Math.ceil(mergedBounds.width * nextScale));
        const nextHeight = Math.max(1, Math.ceil(mergedBounds.height * nextScale));
        const boundsUnchanged = bounds &&
            bounds.minX === mergedBounds.minX &&
            bounds.minY === mergedBounds.minY &&
            bounds.maxX === mergedBounds.maxX &&
            bounds.maxY === mergedBounds.maxY;

        if (rasterCanvas && boundsUnchanged && scale === nextScale && rasterCanvas.width === nextWidth && rasterCanvas.height === nextHeight) {
            return true;
        }

        const nextCanvas = document.createElement('canvas');
        nextCanvas.width = nextWidth;
        nextCanvas.height = nextHeight;
        const nextCtx = nextCanvas.getContext('2d');
        if (!nextCtx) return false;

        if (rasterCanvas && bounds) {
            nextCtx.save();
            nextCtx.scale(nextScale, nextScale);
            nextCtx.translate(-mergedBounds.minX, -mergedBounds.minY);
            nextCtx.drawImage(
                rasterCanvas,
                bounds.minX,
                bounds.minY,
                bounds.width,
                bounds.height
            );
            nextCtx.restore();
        }

        rasterCanvas = nextCanvas;
        rasterCtx = nextCtx;
        bounds = mergedBounds;
        scale = nextScale;
        return true;
    }

    function drawShapes(shapes) {
        if (!Array.isArray(shapes) || !shapes.length) return;

        let batchBounds = null;
        shapes.forEach(shape => {
            batchBounds = mergeRasterPreviewBounds(batchBounds, getRasterPreviewBoundsForShape(shape));
        });

        if (!ensureCanvas(batchBounds) || !rasterCtx || !bounds) return;

        rasterCtx.save();
        rasterCtx.scale(scale, scale);
        rasterCtx.translate(-bounds.minX, -bounds.minY);
        shapes.forEach(shape => {
            if (shape?.items) {
                drawShapeOnCtx(rasterCtx, shape);
            }
        });
        rasterCtx.restore();
    }

    async function drawSvgLayers(svgSource) {
        if (!svgSource || typeof drawSvgLayersToRasterContext !== 'function') return false;

        const svgBounds = typeof getSvgBoundsFromSvgData === 'function'
            ? getSvgBoundsFromSvgData(svgSource)
            : null;

        if (!ensureCanvas(svgBounds || bounds) || !rasterCtx || !bounds) return false;

        return drawSvgLayersToRasterContext(rasterCtx, {
            svgSource,
            bounds,
            scale
        });
    }

    function updateMetadata(metadata) {
        const metadataBounds = getRasterPreviewBoundsFromMetadata(metadata);
        if (metadataBounds) {
            ensureCanvas(metadataBounds);
        }
    }

    function buildPreview() {
        if (!rasterCanvas || !bounds) return null;
        return {
            canvas: rasterCanvas,
            bounds,
            scale,
            kind: 'json'
        };
    }

    return {
        drawShapes,
        drawSvgLayers,
        updateMetadata,
        buildPreview
    };
}

async function buildInitialShapeRasterPreview(shapes, metadata = null, svg = null) {
    const builder = createStreamingShapeRasterBuilder(
        typeof getJsonRasterPreviewTargetScale === 'function'
            ? getJsonRasterPreviewTargetScale()
            : 3
    );
    if (!builder) return null;
    builder.updateMetadata(metadata);
    builder.drawShapes(shapes || []);
    await builder.drawSvgLayers(svg);
    return builder.buildPreview();
}

function loadNormalizedDocument({ shapes, metadata = null, svg = null, sourceFile = null, pageNum = 1, initialRasterPreview = null }) {
    jsonShapes = shapes || [];
    documentMetadata = metadata || null;
    svgData = svg || {};
    jsonData = { metadata: documentMetadata };
    currentJsonSourceFile = sourceFile || null;
    currentJsonGzipPromise = null;
    currentPageNum = pageNum;

    if (initialRasterPreview?.canvas && initialRasterPreview?.bounds) {
        shapeRasterCache = initialRasterPreview;
        shapeRasterPreviewMountedCanvas = null;
    }

    buildLayerIndex();
    setupVisualization();

    if (initialRasterPreview?.canvas && initialRasterPreview?.bounds) {
        scheduleDraw();
    }
}

function convertParsedToNormalizedDocument(parsed) {
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return {
            shapes: normalizeShapesArray(Array.isArray(parsed.shapes) ? parsed.shapes : []),
            metadata: parsed.metadata || null,
            svg: parsed.svg || null
        };
    }

    if (Array.isArray(parsed)) {
        return {
            shapes: normalizeShapesArray(parsed),
            metadata: null,
            svg: null
        };
    }

    throw new Error('Định dạng JSON không hợp lệ (phải là mảng hoặc object).');
}

function extractTopLevelValuesFromParsedDocument(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {};
    }
    const values = {};
    Object.keys(parsed).forEach(key => {
        if (key === 'shapes' || key === 'metadata' || key === 'svg') return;
        values[key] = parsed[key];
    });
    return values;
}

async function loadParsedJsonDocument(parsed, options = {}) {
    const normalizedDocument = convertParsedToNormalizedDocument(parsed);
    const initialRasterPreview = options.buildRasterPreview === true
        ? await buildInitialShapeRasterPreview(
            normalizedDocument.shapes,
            normalizedDocument.metadata,
            normalizedDocument.svg
        )
        : null;
    loadNormalizedDocument({
        ...normalizedDocument,
        sourceFile: options.sourceFile || null,
        pageNum: options.pageNum || 1,
        initialRasterPreview
    });
}

function getFastFullJsonParseLimit() {
    const limit = Number(CONFIG.FAST_FULL_JSON_PARSE_BYTES);
    if (!Number.isFinite(limit) || limit <= 0) {
        return 0;
    }
    return limit;
}

function shouldPreferFastFullJsonParse(totalBytes) {
    if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
        return false;
    }
    const limit = getFastFullJsonParseLimit();
    return limit > 0 && totalBytes <= limit;
}

function isJsonWhitespace(char) {
    return char === ' ' || char === '\n' || char === '\r' || char === '\t';
}

function skipJsonWhitespace(text, startIndex = 0) {
    let index = startIndex;
    while (index < text.length && isJsonWhitespace(text[index])) {
        index += 1;
    }
    return index;
}

function scanJsonStringEnd(text, startIndex) {
    if (text[startIndex] !== '"') {
        throw new Error('Expected JSON string.');
    }

    let escaping = false;
    for (let index = startIndex + 1; index < text.length; index += 1) {
        const char = text[index];
        if (escaping) {
            escaping = false;
            continue;
        }
        if (char === '\\') {
            escaping = true;
            continue;
        }
        if (char === '"') {
            return index + 1;
        }
    }

    return -1;
}

function scanJsonPrimitiveEnd(text, startIndex, isFinalChunk = false) {
    let index = startIndex;
    while (index < text.length) {
        const char = text[index];
        if (char === ',' || char === ']' || char === '}' || isJsonWhitespace(char)) {
            break;
        }
        index += 1;
    }

    if (index === text.length && !isFinalChunk) {
        return -1;
    }

    return index;
}

function scanJsonValueEnd(text, startIndex, isFinalChunk = false) {
    if (startIndex >= text.length) {
        return -1;
    }

    const firstChar = text[startIndex];
    if (firstChar === '"') {
        return scanJsonStringEnd(text, startIndex);
    }

    if (firstChar === '{' || firstChar === '[') {
        const stack = [firstChar];
        let inString = false;
        let escaping = false;

        for (let index = startIndex + 1; index < text.length; index += 1) {
            const char = text[index];
            if (inString) {
                if (escaping) {
                    escaping = false;
                } else if (char === '\\') {
                    escaping = true;
                } else if (char === '"') {
                    inString = false;
                }
                continue;
            }

            if (char === '"') {
                inString = true;
                continue;
            }

            if (char === '{' || char === '[') {
                stack.push(char);
                continue;
            }

            if (char === '}' || char === ']') {
                const openChar = stack.pop();
                const closesObject = openChar === '{' && char === '}';
                const closesArray = openChar === '[' && char === ']';
                if (!closesObject && !closesArray) {
                    throw new Error('Malformed JSON structure.');
                }
                if (stack.length === 0) {
                    return index + 1;
                }
            }
        }

        return -1;
    }

    return scanJsonPrimitiveEnd(text, startIndex, isFinalChunk);
}

function createSpecializedStreamingDocumentParser({ onShape, onMetadata, onSvg, onTopLevelValue }) {
    let buffer = '';
    let position = 0;
    let rootType = null;
    let rootClosed = false;
    let rootArrayState = 'value-or-end';
    let rootObjectState = 'key-or-end';
    let shapesArrayState = 'inactive';
    let currentKey = null;

    function parseJsonSlice(startIndex, endIndex) {
        return JSON.parse(buffer.slice(startIndex, endIndex));
    }

    function dispatchTopLevelValue(key, value) {
        if (key === 'metadata') {
            onMetadata(value);
            return;
        }
        if (key === 'svg') {
            onSvg(value);
            return;
        }
        if (typeof onTopLevelValue === 'function') {
            onTopLevelValue(key, value);
        }
    }

    function trimBufferIfPossible() {
        if (position <= 0) return;
        if (position < 1024 * 1024 && position * 2 < buffer.length) return;
        buffer = buffer.slice(position);
        position = 0;
    }

    function parseRootArray(isFinalChunk) {
        while (true) {
            position = skipJsonWhitespace(buffer, position);
            if (position >= buffer.length) {
                return false;
            }

            if (rootArrayState === 'value-or-end') {
                if (buffer[position] === ']') {
                    position += 1;
                    rootClosed = true;
                    return true;
                }
                const valueEnd = scanJsonValueEnd(buffer, position, isFinalChunk);
                if (valueEnd < 0) {
                    return false;
                }
                onShape(parseJsonSlice(position, valueEnd));
                position = valueEnd;
                rootArrayState = 'comma-or-end';
                continue;
            }

            if (rootArrayState === 'comma-or-end') {
                const nextChar = buffer[position];
                if (nextChar === ',') {
                    position += 1;
                    rootArrayState = 'value-or-end';
                    return true;
                }
                if (nextChar === ']') {
                    position += 1;
                    rootClosed = true;
                    return true;
                }
                throw new Error('Expected , or ] in root array.');
            }
        }
    }

    function parseShapesArray(isFinalChunk) {
        while (true) {
            position = skipJsonWhitespace(buffer, position);
            if (position >= buffer.length) {
                return false;
            }

            if (shapesArrayState === 'value-or-end') {
                if (buffer[position] === ']') {
                    position += 1;
                    shapesArrayState = 'inactive';
                    rootObjectState = 'comma-or-end';
                    return true;
                }
                const valueEnd = scanJsonValueEnd(buffer, position, isFinalChunk);
                if (valueEnd < 0) {
                    return false;
                }
                onShape(parseJsonSlice(position, valueEnd));
                position = valueEnd;
                shapesArrayState = 'comma-or-end';
                continue;
            }

            if (shapesArrayState === 'comma-or-end') {
                const nextChar = buffer[position];
                if (nextChar === ',') {
                    position += 1;
                    shapesArrayState = 'value-or-end';
                    return true;
                }
                if (nextChar === ']') {
                    position += 1;
                    shapesArrayState = 'inactive';
                    rootObjectState = 'comma-or-end';
                    return true;
                }
                throw new Error('Expected , or ] in shapes array.');
            }
        }
    }

    function parseRootObject(isFinalChunk) {
        if (shapesArrayState !== 'inactive') {
            return parseShapesArray(isFinalChunk);
        }

        while (true) {
            position = skipJsonWhitespace(buffer, position);
            if (position >= buffer.length) {
                return false;
            }

            if (rootObjectState === 'key-or-end') {
                if (buffer[position] === '}') {
                    position += 1;
                    rootClosed = true;
                    return true;
                }
                const keyEnd = scanJsonStringEnd(buffer, position);
                if (keyEnd < 0) {
                    return false;
                }
                currentKey = parseJsonSlice(position, keyEnd);
                position = keyEnd;
                rootObjectState = 'colon';
                continue;
            }

            if (rootObjectState === 'colon') {
                if (buffer[position] !== ':') {
                    throw new Error('Expected : after JSON object key.');
                }
                position += 1;
                rootObjectState = 'value';
                continue;
            }

            if (rootObjectState === 'value') {
                position = skipJsonWhitespace(buffer, position);
                if (position >= buffer.length) {
                    return false;
                }

                if (currentKey === 'shapes') {
                    if (buffer[position] !== '[') {
                        throw new Error('Expected shapes to be a JSON array.');
                    }
                    position += 1;
                    currentKey = null;
                    shapesArrayState = 'value-or-end';
                    return true;
                }

                const valueEnd = scanJsonValueEnd(buffer, position, isFinalChunk);
                if (valueEnd < 0) {
                    return false;
                }
                dispatchTopLevelValue(currentKey, parseJsonSlice(position, valueEnd));
                currentKey = null;
                position = valueEnd;
                rootObjectState = 'comma-or-end';
                continue;
            }

            if (rootObjectState === 'comma-or-end') {
                const nextChar = buffer[position];
                if (nextChar === ',') {
                    position += 1;
                    rootObjectState = 'key-or-end';
                    return true;
                }
                if (nextChar === '}') {
                    position += 1;
                    rootClosed = true;
                    return true;
                }
                throw new Error('Expected , or } in root object.');
            }
        }
    }

    function parseAvailable(isFinalChunk) {
        while (true) {
            if (rootClosed) {
                position = skipJsonWhitespace(buffer, position);
                if (position < buffer.length) {
                    if (!isFinalChunk) {
                        return;
                    }
                    throw new Error('Unexpected trailing JSON content.');
                }
                return;
            }

            if (rootType === null) {
                position = skipJsonWhitespace(buffer, position);
                if (position >= buffer.length) {
                    return;
                }
                const firstChar = buffer[position];
                if (firstChar === '[') {
                    rootType = 'array';
                    position += 1;
                    trimBufferIfPossible();
                    continue;
                }
                if (firstChar === '{') {
                    rootType = 'object';
                    position += 1;
                    trimBufferIfPossible();
                    continue;
                }
                throw new Error('JSON document must start with an object or array.');
            }

            const didAdvance = rootType === 'array'
                ? parseRootArray(isFinalChunk)
                : parseRootObject(isFinalChunk);

            if (!didAdvance) {
                return;
            }

            trimBufferIfPossible();
        }
    }

    return {
        write(chunk) {
            if (chunk) {
                buffer += chunk;
            }
            parseAvailable(false);
        },
        close() {
            parseAvailable(true);
            if (!rootClosed) {
                throw new Error('Unexpected end of JSON stream.');
            }
        }
    };
}

async function parseJsonByteStreamToDocument(reader, { totalBytes = 0, sourceLabel = 'JSON', buildRasterPreview = false, onProgress = null } = {}) {
    const decoder = new TextDecoder('utf-8');
    const shapes = [];
    let metadata = null;
    let svg = null;
    const topLevelValues = {};
    let nextShapeId = 0;
    let bytesRead = 0;
    let lastProgressBytes = 0;
    const rasterPreviewBuilder = buildRasterPreview
        ? createStreamingShapeRasterBuilder(
            typeof getJsonRasterPreviewTargetScale === 'function'
                ? getJsonRasterPreviewTargetScale()
                : 3
        )
        : null;
    const pendingRasterShapes = [];
    let rasterSvgDrawn = false;

    function flushPendingRasterShapes() {
        if (!rasterPreviewBuilder || pendingRasterShapes.length === 0) return;
        rasterPreviewBuilder.drawShapes(pendingRasterShapes);
        pendingRasterShapes.length = 0;
    }

    async function flushPendingRasterSvg() {
        if (!rasterPreviewBuilder || rasterSvgDrawn || !svg) return;
        const svgReady = await rasterPreviewBuilder.drawSvgLayers(svg);
        if (svgReady) {
            rasterSvgDrawn = true;
        }
    }

    const parser = createSpecializedStreamingDocumentParser({
        onShape(shape) {
            const normalizedShape = normalizeShapeForViewer(shape, nextShapeId);
            shapes.push(normalizedShape);
            pendingRasterShapes.push(normalizedShape);
            nextShapeId += 1;
        },
        onMetadata(value) {
            metadata = value;
            rasterPreviewBuilder?.updateMetadata(value);
        },
        onSvg(value) {
            svg = value;
        },
        onTopLevelValue(key, value) {
            topLevelValues[key] = value;
        }
    });

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunkBytes = value.byteLength ?? value.length ?? 0;
        bytesRead += chunkBytes;
        const chunkText = decoder.decode(value, { stream: true });
        if (chunkText) {
            parser.write(chunkText);
        }

        if (bytesRead - lastProgressBytes >= CONFIG.JSON_PROGRESS_UPDATE_BYTES) {
            flushPendingRasterShapes();
            await flushPendingRasterSvg();
            const progressText = totalBytes > 0
                ? `${formatBytes(bytesRead)} / ${formatBytes(totalBytes)}${UI_TEXT.BULLET_SEPARATOR}${nextShapeId.toLocaleString()} shapes`
                : `${formatBytes(bytesRead)}${UI_TEXT.BULLET_SEPARATOR}${nextShapeId.toLocaleString()} shapes`;
            if (typeof onProgress === 'function') {
                onProgress({
                    title: `Loading ${sourceLabel}...`,
                    subtitle: progressText,
                    bytesRead,
                    totalBytes,
                    shapesCount: nextShapeId
                });
            } else {
                updateLoadingPopup(`Loading ${sourceLabel}...`, progressText);
            }
            lastProgressBytes = bytesRead;
            await yieldToBrowser();
        }
    }

    const trailingText = decoder.decode();
    if (trailingText) {
        parser.write(trailingText);
    }
    parser.close();
    flushPendingRasterShapes();
    await flushPendingRasterSvg();
    return {
        shapes,
        metadata,
        svg,
        topLevelValues,
        initialRasterPreview: rasterPreviewBuilder?.buildPreview() || null
    };
}

async function loadJsonFileStreaming(file) {
    clearVisualization();
    cachedPages = {};
    if (typeof releaseCurrentPdfResources === 'function') {
        await releaseCurrentPdfResources();
    }
    currentPdfFile = null;
    showLoadingPopup('Loading JSON...', `${file.name}${UI_TEXT.BULLET_SEPARATOR}${formatBytes(file.size)}`);

    try {
        if (typeof file.text === 'function' && shouldPreferFastFullJsonParse(file.size)) {
            updateLoadingPopup('Reading JSON...', `${file.name}${UI_TEXT.BULLET_SEPARATOR}${formatBytes(file.size)}${UI_TEXT.BULLET_SEPARATOR}native parse`);
            await yieldToBrowser();
            const text = await file.text();
            updateLoadingPopup('Parsing JSON...', `${file.name}${UI_TEXT.BULLET_SEPARATOR}${formatBytes(file.size)}${UI_TEXT.BULLET_SEPARATOR}native parse`);
            await yieldToBrowser();
            await loadParsedJsonDocument(JSON.parse(text), { sourceFile: file, pageNum: 1, buildRasterPreview: false });
        } else if (typeof file.stream === 'function') {
            const documentData = await parseJsonByteStreamToDocument(file.stream().getReader(), {
                totalBytes: file.size,
                sourceLabel: file.name || 'JSON',
                buildRasterPreview: false
            });
            updateLoadingPopup('Finalizing JSON...', `${documentData.shapes.length.toLocaleString()} shapes ready`);
            await yieldToBrowser();
            loadNormalizedDocument({ ...documentData, sourceFile: file, pageNum: 1 });
        } else {
            if (file.size > CONFIG.MAX_SAFE_FULL_JSON_PARSE_BYTES) {
                throw new Error('Browser does not support streaming JSON parsing for files this large.');
            }
            const text = await file.text();
            await loadParsedJsonDocument(JSON.parse(text), { sourceFile: file, pageNum: 1, buildRasterPreview: false });
        }

        dropZone.classList.add('hidden');
    } finally {
        hideLoadingPopup();
    }
}

async function loadJsonResponseStreaming(response, { sourceLabel = 'JSON response', sessionCacheKey = null, pageNum = 1, onProgress = null, autoLoad = true } = {}) {
    const contentLength = Number.parseInt(response.headers.get('content-length') || '0', 10) || 0;

    if (shouldPreferFastFullJsonParse(contentLength)) {
        if (typeof onProgress === 'function') {
            const subtitle = contentLength > 0
                ? `${formatBytes(contentLength)}${UI_TEXT.BULLET_SEPARATOR}native parse`
                : 'native parse';
            onProgress({
                title: `Reading ${sourceLabel}...`,
                subtitle,
                bytesRead: 0,
                totalBytes: contentLength,
                shapesCount: 0
            });
        }
        const text = await response.text();
        if (sessionCacheKey && text.length <= CONFIG.JSON_SESSION_CACHE_MAX_BYTES) {
            try {
                sessionStorage.setItem(sessionCacheKey, text);
            } catch (error) {
                console.warn('Failed to cache example JSON in sessionStorage:', error);
            }
        }
        const parsed = JSON.parse(text);
        const topLevelValues = extractTopLevelValuesFromParsedDocument(parsed);
        if (topLevelValues.error) {
            throw new Error(topLevelValues.error);
        }
        const normalizedDocument = convertParsedToNormalizedDocument(parsed);
        const documentData = {
            ...normalizedDocument,
            topLevelValues,
            initialRasterPreview: null
        };
        if (autoLoad !== false) {
            loadNormalizedDocument({ ...documentData, pageNum });
        }
        return {
            ...documentData,
            shapesCount: documentData.shapes.length
        };
    }

    if (response.body) {
        const documentData = await parseJsonByteStreamToDocument(response.body.getReader(), {
            totalBytes: contentLength,
            sourceLabel,
            buildRasterPreview: false,
            onProgress
        });
        if (documentData.topLevelValues?.error) {
            throw new Error(documentData.topLevelValues.error);
        }
        if (autoLoad !== false) {
            loadNormalizedDocument({ ...documentData, pageNum });
        }
        return documentData;
    }

    const text = await response.text();
    if (sessionCacheKey && text.length <= CONFIG.JSON_SESSION_CACHE_MAX_BYTES) {
        try {
            sessionStorage.setItem(sessionCacheKey, text);
        } catch (error) {
            console.warn('Failed to cache example JSON in sessionStorage:', error);
        }
    }
    const parsed = JSON.parse(text);
    const topLevelValues = extractTopLevelValuesFromParsedDocument(parsed);
    if (topLevelValues.error) {
        throw new Error(topLevelValues.error);
    }
    const normalizedDocument = convertParsedToNormalizedDocument(parsed);
    const documentData = {
        ...normalizedDocument,
        topLevelValues,
        initialRasterPreview: null
    };
    if (autoLoad !== false) {
        loadNormalizedDocument({ ...documentData, pageNum });
    }
    return {
        ...documentData,
        shapesCount: documentData.shapes.length
    };
}

function getBase64DecodedByteLength(base64Value) {
    if (!base64Value || typeof base64Value !== 'string') return 0;
    const trimmed = base64Value.trim();
    if (!trimmed) return 0;
    let padding = 0;
    if (trimmed.endsWith('==')) {
        padding = 2;
    } else if (trimmed.endsWith('=')) {
        padding = 1;
    }
    return Math.max(0, Math.floor((trimmed.length * 3) / 4) - padding);
}

function decodeBase64ToUint8Array(base64Value) {
    const sanitized = (base64Value || '').replace(/\s+/g, '');
    const outputLength = getBase64DecodedByteLength(sanitized);
    const bytes = new Uint8Array(outputLength);
    if (!outputLength) {
        return bytes;
    }

    const chunkChars = 4 * 8192; // keep each chunk aligned to base64 quantum
    let byteOffset = 0;
    for (let i = 0; i < sanitized.length; i += chunkChars) {
        const chunk = sanitized.slice(i, i + chunkChars);
        if (!chunk) continue;
        const binary = atob(chunk);
        for (let j = 0; j < binary.length; j++) {
            bytes[byteOffset++] = binary.charCodeAt(j);
        }
    }
    return bytes;
}

async function parseGzipBase64ToDocumentStreaming(gzipB64, { sourceLabel = 'JSON gzip', onProgress = null } = {}) {
    const gzipBytes = decodeBase64ToUint8Array(gzipB64);
    if (!gzipBytes.length) {
        throw new Error('Empty gzip payload.');
    }

    const decompressedStream = new Blob([gzipBytes]).stream().pipeThrough(new DecompressionStream('gzip'));

    if (decompressedStream && typeof decompressedStream.getReader === 'function') {
        return parseJsonByteStreamToDocument(decompressedStream.getReader(), {
            sourceLabel,
            buildRasterPreview: false,
            onProgress
        });
    }

    // Fallback for environments without ReadableStream reader support.
    const decompressedText = await new Response(decompressedStream).text();
    const parsed = JSON.parse(decompressedText);
    const normalizedDocument = convertParsedToNormalizedDocument(parsed);
    return {
        ...normalizedDocument,
        initialRasterPreview: null,
        topLevelValues: extractTopLevelValuesFromParsedDocument(parsed)
    };
}

async function compressStreamToGzipBase64(stream) {
    const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
    const reader = compressedStream.getReader();
    const chunks = [];
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
    }
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
    }
    let binaryStr = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < combined.length; i += chunkSize) {
        binaryStr += String.fromCharCode(...combined.subarray(i, i + chunkSize));
    }
    return btoa(binaryStr);
}

// Compress JSON to base64-gzipped format using CompressionStream API
async function compressJsonToGzipBase64(jsonString) {
    return compressStreamToGzipBase64(new Blob([jsonString]).stream());
}

async function compressFileToGzipBase64(file) {
    if (!file?.stream) {
        throw new Error('Streaming file compression is not supported in this browser.');
    }
    return compressStreamToGzipBase64(file.stream());
}

async function ensurePipelineCacheForCurrentDocument() {
    if (currentPageNum && cachedPages[currentPageNum]) {
        return cachedPages[currentPageNum];
    }
    if (!currentJsonSourceFile) {
        return null;
    }

    if (!currentJsonGzipPromise) {
        currentJsonGzipPromise = compressFileToGzipBase64(currentJsonSourceFile)
            .then(gzipData => {
                cachedPages = { 1: gzipData };
                currentPageNum = 1;
                return gzipData;
            })
            .finally(() => {
                currentJsonGzipPromise = null;
            });
    }

    return currentJsonGzipPromise;
}