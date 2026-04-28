// utils.js
function formatBytes(byteCount) {
    if (!Number.isFinite(byteCount) || byteCount <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = byteCount;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }
    return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function showLoadingPopup(title = 'Processing...', subtitle = '') {
    const popup = document.getElementById('loading-popup');
    if (!popup) return;
    popup.style.display = 'flex';
    const titleEl = document.getElementById('loading-popup-title');
    const subtitleEl = document.getElementById('loading-popup-subtitle');
    if (titleEl) titleEl.textContent = title;
    if (subtitleEl) {
        subtitleEl.textContent = subtitle || '';
        subtitleEl.style.display = subtitle ? 'block' : 'none';
    }
}

function hideLoadingPopup() {
    const popup = document.getElementById('loading-popup');
    if (!popup) return;
    popup.style.display = 'none';
}

function updateLoadingPopup(title = 'Processing...', subtitle = '') {
    showLoadingPopup(title, subtitle);
}

function yieldToBrowser() {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

function hasRenderableDocument() {
    return Boolean((jsonShapes && jsonShapes.length) || (svgData && (svgData.text_only || svgData.graphic_only)));
}

function setShapeBboxFromRect(shape) {
    if (!shape?.rect || shape.rect.length !== 4) return false;
    const [minX, minY, maxX, maxY] = shape.rect;
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) return false;
    shape.bbox = { minX, minY, maxX, maxY };
    return true;
}

function computeShapeBbox(shape) {
    if (shape.bbox) return;
    if (setShapeBboxFromRect(shape)) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    if (shape.items && shape.items.length > 0) {
        for (const item of shape.items) {
            const type = item[0];
            if (type === 'l') {
                const p1 = item[1], p2 = item[2];
                if (p1 && p2) {
                    minX = Math.min(minX, p1[0], p2[0]);
                    minY = Math.min(minY, p1[1], p2[1]);
                    maxX = Math.max(maxX, p1[0], p2[0]);
                    maxY = Math.max(maxY, p1[1], p2[1]);
                }
            } else if (type === 'c') {
                const p0 = item[1], p1 = item[2], p2 = item[3], p3 = item[4];
                if (p0 && p1 && p2 && p3) {
                    minX = Math.min(minX, p0[0], p1[0], p2[0], p3[0]);
                    minY = Math.min(minY, p0[1], p1[1], p2[1], p3[1]);
                    maxX = Math.max(maxX, p0[0], p1[0], p2[0], p3[0]);
                    maxY = Math.max(maxY, p0[1], p1[1], p2[1], p3[1]);
                }
            } else if (type === 'qu' || type === 'poly') {
                const points = item[1];
                if (Array.isArray(points)) {
                    for (const p of points) {
                        if (p) {
                            minX = Math.min(minX, p[0]);
                            minY = Math.min(minY, p[1]);
                            maxX = Math.max(maxX, p[0]);
                            maxY = Math.max(maxY, p[1]);
                        }
                    }
                }
            }
        }
    }
    if (minX !== Infinity) {
        shape.bbox = { minX, minY, maxX, maxY };
    }
}

function toRgbString(color, alpha = 1) {
    if (Array.isArray(color)) return `rgba(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)}, ${alpha})`;
    if (typeof color === 'number') return `rgba(${(color >> 16) & 255}, ${(color >> 8) & 255}, ${color & 255}, ${alpha})`;
    return `rgba(0, 0, 0, ${alpha})`;
}

function getShapeStyleIndex(rawValue, fallback = 0) {
    const numeric = Array.isArray(rawValue) ? Number(rawValue[0]) : Number(rawValue);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(0, Math.min(2, Math.trunc(numeric)));
}

function getCanvasLineCap(shape) {
    switch (getShapeStyleIndex(shape?.lineCap, 0)) {
        case 1:
            return 'round';
        case 2:
            return 'square';
        default:
            return 'butt';
    }
}

function getCanvasLineJoin(shape) {
    switch (getShapeStyleIndex(shape?.lineJoin, 0)) {
        case 1:
            return 'round';
        case 2:
            return 'bevel';
        default:
            return 'miter';
    }
}

function applyShapeStrokeGeometry(targetCtx, shape) {
    if (!targetCtx) return;
    targetCtx.lineCap = shape?._strokeLineCap || getCanvasLineCap(shape);
    targetCtx.lineJoin = shape?._strokeLineJoin || getCanvasLineJoin(shape);
}

function getContextStrokeScale(targetCtx) {
    if (!targetCtx || typeof targetCtx.getTransform !== 'function') {
        return 1;
    }

    const transform = targetCtx.getTransform();
    const scaleX = Math.hypot(transform.a, transform.b);
    const scaleY = Math.hypot(transform.c, transform.d);
    const scale = Math.max(scaleX, scaleY);
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function getEffectiveWidth(width, targetCtx = null) {
    if (width === undefined || width === null) {
        return CONFIG.MIN_LINE_WIDTH;
    }

    const numeric = Number(width);
    if (!Number.isFinite(numeric)) {
        return CONFIG.MIN_LINE_WIDTH;
    }
    if (numeric <= 0) {
        return Math.max(1 / getContextStrokeScale(targetCtx), 0.01);
    }
    return numeric;
}

function getShapeVisibilityPadding(width) {
    const numeric = Number(width);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return CONFIG.MIN_LINE_WIDTH;
    }
    return Math.max(numeric, CONFIG.MIN_LINE_WIDTH);
}
function calculateLength(type, item) {
    // PERFORMANCE: Check cache first
    if (lengthCache.has(item)) {
        return lengthCache.get(item);
    }
    
    let len = 0;
    switch (type) {
        case 'l': {
            const [x1, y1] = item[1], [x2, y2] = item[2];
            len = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
            break;
        }
        case 'c': {
            const [p0x, p0y] = item[1], [p1x, p1y] = item[2], [p2x, p2y] = item[3], [p3x, p3y] = item[4];
            const d1 = Math.sqrt((p1x - p0x) ** 2 + (p1y - p0y) ** 2);
            const d2 = Math.sqrt((p2x - p1x) ** 2 + (p2y - p1y) ** 2);
            const d3 = Math.sqrt((p3x - p2x) ** 2 + (p3y - p2y) ** 2);
            len = d1 + d2 + d3;
            break;
        }
        case 'qu': {
            const points = item[1];
            if (points.length === 4) {
                const d1 = Math.sqrt((points[1][0] - points[0][0]) ** 2 + (points[1][1] - points[0][1]) ** 2);
                const d2 = Math.sqrt((points[3][0] - points[1][0]) ** 2 + (points[3][1] - points[1][1]) ** 2);
                const d3 = Math.sqrt((points[2][0] - points[3][0]) ** 2 + (points[2][1] - points[3][1]) ** 2);
                const d4 = Math.sqrt((points[0][0] - points[2][0]) ** 2 + (points[0][1] - points[2][1]) ** 2);
                len = d1 + d2 + d3 + d4;
            } else {
                lengthCache.set(item, 0);
                return 0;
            }
            break;
        }
        case 'poly': {
            const points = item[1];
            if (!points || points.length < 2) {
                lengthCache.set(item, 0);
                return 0;
            }
            for (let i = 0; i < points.length; i++) {
                const [x1, y1] = points[i];
                const [x2, y2] = points[(i + 1) % points.length];
                len += Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
            }
            break;
        }
        default:
            lengthCache.set(item, 0);
            return 0;
    }
    
    // PERFORMANCE: Cache the result
    lengthCache.set(item, len);
    return len;
}
function getDisplayLengths(arr) {
    if (arr.length <= 6) return arr.map(l => l.toFixed(2)).join(', ');
    const first3 = arr.slice(0, 3).map(l => l.toFixed(2)).join(', ');
    const last3 = arr.slice(-3).map(l => l.toFixed(2)).join(', ');
    return `${first3} ... ${last3}`;
}

function getSeqnoEntryIndices(entry) {
    if (Array.isArray(entry)) return entry;
    if (typeof entry === 'string') return entry.split('-').map(Number);
    return [null, null];
}

function invalidateSeqnoHoverIndex() {
    globalSeqnoToIds = {};
    seqnoEndpoints = {};
    seqnoToLayer = {};
    seqnoGroups = {};
    groupToSeqnos = {};
    hoveredGroup = null;
    seqnoHoverIndexReady = false;
}

function ensureSeqnoHoverIndex() {
    if (seqnoHoverIndexReady) return;

    invalidateSeqnoHoverIndex();

    const shapes = Array.isArray(allShapesSorted) ? allShapesSorted : [];
    for (let objIndex = 0; objIndex < shapes.length; objIndex += 1) {
        const obj = shapes[objIndex];
        if (!obj?.items || !Array.isArray(obj.items)) continue;
        if (!obj.color || !Array.isArray(obj.color) || obj.color.length < 3) continue;
        if (obj.color[0] !== 0 || obj.color[1] !== 0 || obj.color[2] !== 0) continue;

        const seqno = obj.seqno || 0;
        globalSeqnoToIds[seqno] ??= [];
        seqnoEndpoints[seqno] ??= { start: null, end: null };
        seqnoToLayer[seqno] = obj.layer;

        for (let itemIndex = 0; itemIndex < obj.items.length; itemIndex += 1) {
            const item = obj.items[itemIndex];
            globalSeqnoToIds[seqno].push([objIndex, itemIndex]);

            let startPoint = null;
            let endPoint = null;
            const type = item?.[0];
            if (type === 'l') {
                startPoint = item[1];
                endPoint = item[2];
            } else if (type === 'c') {
                startPoint = item[1];
                endPoint = item[4];
            } else if (type === 'qu') {
                const points = item[1];
                if (points?.length === 4) {
                    startPoint = points[0];
                    endPoint = points[2];
                }
            }

            if (startPoint && !seqnoEndpoints[seqno].start) {
                seqnoEndpoints[seqno].start = startPoint;
            }
            if (endPoint) {
                seqnoEndpoints[seqno].end = endPoint;
            }
        }
    }

    seqnoHoverIndexReady = true;
    linkConsecutiveSeqnos();
}

// FIXED: Sß╗¡ dß╗Ñng globalSeqnoToIds
function getSeqnoStartEnd(seqno) {
    const endpoints = seqnoEndpoints[seqno];
    if (endpoints) {
        return [endpoints.start || null, endpoints.end || null];
    }
    const ids = globalSeqnoToIds[seqno];
    if (!ids || !ids.length) return [null, null];
    let start = null, end = null;
    for (const id of ids) {
        const [objIndex, itemIndex] = getSeqnoEntryIndices(id);
        const obj = allShapesSorted?.[objIndex];
        if (!obj?.items?.[itemIndex]) continue;
        const item = obj.items[itemIndex];
        const type = item[0];
        if (type === 'l') {
            if (!start) start = item[1];
            end = item[2];
        } else if (type === 'c') {
            if (!start) start = item[1];
            end = item[4];
        } else if (type === 'qu') {
            if (!start) start = item[1][0];
            end = item[1][2];
        }
    }
    return [start, end];
}

// FIXED: Sß╗¡ dß╗Ñng globalSeqnoToIds
function linkConsecutiveSeqnos() {
    seqnoGroups = {};
    groupToSeqnos = {};
    const seqnos = Object.keys(globalSeqnoToIds).map(Number).sort((a, b) => a - b);
    const groups = {}; // union-find
    seqnos.forEach(seqno => groups[seqno] = seqno);

    function find(x) {
        if (groups[x] !== x) {
            groups[x] = find(groups[x]);
        }
        return groups[x];
    }

    function union(x, y) {
        const px = find(x), py = find(y);
        if (px !== py) {
            groups[px] = py;
        }
    }

    for (let i = 0; i < seqnos.length - 1; i++) {
        const seq1 = seqnos[i];
        const seq2 = seqnos[i + 1];
        if (Math.abs(seq1 - seq2) === 1) { // seqno liß╗ün nhau
            const [end1] = getSeqnoStartEnd(seq1);
            const [start2] = getSeqnoStartEnd(seq2);
            if (end1 && start2) {
                const dist = Math.sqrt((end1[0] - start2[0]) ** 2 + (end1[1] - start2[1]) ** 2);
                if (dist < 8 && seqnoToLayer[seq1] === seqnoToLayer[seq2]) {
                    union(seq1, seq2);
                }
            }
        }
    }

    const groupMap = {};
    seqnos.forEach(seqno => {
        const group = find(seqno);
        if (!groupMap[group]) groupMap[group] = [];
        groupMap[group].push(seqno);
    });

    let groupId = 0;
    Object.values(groupMap).forEach(groupSeqnos => {
        groupSeqnos.forEach(seqno => {
            seqnoGroups[seqno] = groupId;
        });
        groupToSeqnos[groupId] = groupSeqnos;
        groupId++;
    });
}
function bboxInside(innerBbox, outerBbox) {
    return innerBbox[0] >= outerBbox[0] && innerBbox[1] >= outerBbox[1] &&
        innerBbox[2] <= outerBbox[2] && innerBbox[3] <= outerBbox[3];
}
function bboxesOverlap(bbox1, bbox2) {
    return !(bbox1.x + bbox1.width < bbox2.x ||
        bbox2.x + bbox2.width < bbox1.x ||
        bbox1.y + bbox1.height < bbox2.y ||
        bbox2.y + bbox2.height < bbox1.y);
}
function bboxOverlapPercentage(bbox1, bbox2) {
    if (bbox1.x + bbox1.width <= bbox2.x ||
        bbox2.x + bbox2.width <= bbox1.x ||
        bbox1.y + bbox1.height <= bbox2.y ||
        bbox2.y + bbox2.height <= bbox1.y) {
        return 0;
    }
    const xOverlap = Math.min(bbox1.x + bbox1.width, bbox2.x + bbox2.width) - Math.max(bbox1.x, bbox2.x);
    const yOverlap = Math.min(bbox1.y + bbox1.height, bbox2.y + bbox2.height) - Math.max(bbox1.y, bbox2.y);
    const overlapArea = xOverlap * yOverlap;
    const area1 = bbox1.width * bbox1.height;
    const area2 = bbox2.width * bbox2.height;
    const smallerArea = Math.min(area1, area2);
    return (overlapArea / smallerArea) * 100;
}

function calculateIoU(bbox1, bbox2) {
    const x1 = Math.max(bbox1.x, bbox2.x);
    const y1 = Math.max(bbox1.y, bbox2.y);
    const x2 = Math.min(bbox1.x + bbox1.width, bbox2.x + bbox2.width);
    const y2 = Math.min(bbox1.y + bbox1.height, bbox2.y + bbox2.height);

    if (x2 <= x1 || y2 <= y1) return 0;

    const intersection = (x2 - x1) * (y2 - y1);
    const area1 = bbox1.width * bbox1.height;
    const area2 = bbox2.width * bbox2.height;
    const union = area1 + area2 - intersection;

    return intersection / union;
}
// Hit-test & Selection
function distancePointToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy);
    t = Math.max(0, Math.min(1, t));
    const projX = x1 + t * dx, projY = y1 + t * dy;
    return Math.hypot(px - projX, py - projY);
}
function sampleCubic(p0, p1, p2, p3, t) {
    const mt = 1 - t;
    return [
        mt * mt * mt * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t * t * t * p3[0],
        mt * mt * mt * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t * t * t * p3[1]
    ];
}
function distancePointToCubic(px, py, p0, p1, p2, p3) {
    let minD = Infinity, prev = p0;
    const STEPS = 12;
    for (let i = 1; i <= STEPS; i++) {
        const cur = sampleCubic(p0, p1, p2, p3, i / STEPS);
        const d = distancePointToSegment(px, py, prev[0], prev[1], cur[0], cur[1]);
        if (d < minD) minD = d;
        prev = cur;
    }
    return minD;
}
function pointNearItem(px, py, ci, worldTol) {
    const item = ci.obj.items[ci.itemIndex], type = item[0];
    if (type === 'l') {
        const [x1, y1] = item[1], [x2, y2] = item[2];
        return distancePointToSegment(px, py, x1, y1, x2, y2) <= worldTol;
    } else if (type === 'c') {
        return distancePointToCubic(px, py, item[1], item[2], item[3], item[4]) <= worldTol;
    } else if (type === 'qu') {
        const pts = item[1];
        if (!pts || pts.length !== 4) return false;
        const edges = [[pts[0], pts[1]], [pts[1], pts[3]], [pts[3], pts[2]], [pts[2], pts[0]]];
        return Math.min(...edges.map(([a, b]) => distancePointToSegment(px, py, a[0], a[1], b[0], b[1]))) <= worldTol;
    }
    return false;
}

function extractSvgViewBoxBounds(svgContent) {
    if (!svgContent) return null;
    const match = svgContent.match(/viewBox=["']([^"']+)["']/);
    if (match) {
        const parts = match[1].split(/[\s,]+/).map(Number);
        if (parts.length === 4 && parts.every(n => !isNaN(n))) {
            return { minX: parts[0], minY: parts[1], maxX: parts[0] + parts[2], maxY: parts[1] + parts[3] };
        }
    }
    const widthMatch = svgContent.match(/width=["'](\d+)/);
    const heightMatch = svgContent.match(/height=["'](\d+)/);
    if (widthMatch && heightMatch) {
        const w = parseFloat(widthMatch[1]);
        const h = parseFloat(heightMatch[1]);
        if (!isNaN(w) && !isNaN(h)) {
            return { minX: 0, minY: 0, maxX: w, maxY: h };
        }
    }
    return null;
}

function mergeBounds(boundsA, boundsB) {
    if (!boundsA && !boundsB) return null;
    if (!boundsA) {
        return {
            minX: boundsB.minX,
            minY: boundsB.minY,
            maxX: boundsB.maxX,
            maxY: boundsB.maxY,
            width: Math.max(1, boundsB.maxX - boundsB.minX),
            height: Math.max(1, boundsB.maxY - boundsB.minY)
        };
    }
    if (!boundsB) {
        return {
            minX: boundsA.minX,
            minY: boundsA.minY,
            maxX: boundsA.maxX,
            maxY: boundsA.maxY,
            width: Math.max(1, boundsA.maxX - boundsA.minX),
            height: Math.max(1, boundsA.maxY - boundsA.minY)
        };
    }

    const minX = Math.min(boundsA.minX, boundsB.minX);
    const minY = Math.min(boundsA.minY, boundsB.minY);
    const maxX = Math.max(boundsA.maxX, boundsB.maxX);
    const maxY = Math.max(boundsA.maxY, boundsB.maxY);

    return {
        minX,
        minY,
        maxX,
        maxY,
        width: Math.max(1, maxX - minX),
        height: Math.max(1, maxY - minY)
    };
}

function getBoundsFromBbox(bbox) {
    if (!bbox) return null;
    const { minX, minY, maxX, maxY } = bbox;
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

function getJsonRasterPreviewTargetScale() {
    if (Number.isFinite(CONFIG?.JSON_RASTER_CACHE_SCALE)) {
        return CONFIG.JSON_RASTER_CACHE_SCALE;
    }
    if (Number.isFinite(CONFIG?.PDF_PAGE_CACHE_SCALE)) {
        return CONFIG.PDF_PAGE_CACHE_SCALE;
    }
    return 3;
}

function getSvgBoundsFromSvgData(svgSource) {
    if (!svgSource) return null;
    return mergeBounds(
        extractSvgViewBoxBounds(svgSource.text_only),
        extractSvgViewBoxBounds(svgSource.graphic_only)
    );
}

function buildSvgRasterMarkup(svgSource, bounds, {
    includeText = true,
    includeGraphic = true,
    rasterScale = getJsonRasterPreviewTargetScale()
} = {}) {
    if (!svgSource || !bounds) return null;

    const widthPx = Math.max(1, Math.ceil(bounds.width * rasterScale));
    const heightPx = Math.max(1, Math.ceil(bounds.height * rasterScale));
    const serializer = new XMLSerializer();
    const parts = [];

    function appendSvgLayer(svgContent) {
        if (!svgContent) return;
        const svgDoc = new DOMParser().parseFromString(svgContent, 'image/svg+xml');
        const svgRoot = svgDoc.documentElement;
        if (!svgRoot || svgRoot.nodeName === 'parsererror') return;

        Array.from(svgRoot.children).forEach(child => {
            parts.push(serializer.serializeToString(child));
        });
    }

    if (includeGraphic) appendSvgLayer(svgSource.graphic_only);
    if (includeText) appendSvgLayer(svgSource.text_only);
    if (!parts.length) return null;

    return [
        `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}" width="${widthPx}" height="${heightPx}" preserveAspectRatio="none">`,
        parts.join('\n'),
        '</svg>'
    ].join('');
}

async function drawSvgLayersToRasterContext(targetCtx, {
    svgSource,
    bounds,
    scale = getJsonRasterPreviewTargetScale(),
    includeText = true,
    includeGraphic = true
} = {}) {
    if (!targetCtx || !svgSource || !bounds) return false;

    const svgMarkup = buildSvgRasterMarkup(svgSource, bounds, {
        includeText,
        includeGraphic,
        rasterScale: scale
    });
    if (!svgMarkup) return false;

    const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
    let drawable = null;
    let imageUrl = null;

    try {
        if (typeof createImageBitmap === 'function') {
            try {
                drawable = await createImageBitmap(blob);
            } catch (error) {
                drawable = null;
            }
        }

        if (!drawable) {
            imageUrl = URL.createObjectURL(blob);
            drawable = await new Promise((resolve, reject) => {
                const nextImage = new Image();
                nextImage.onload = () => resolve(nextImage);
                nextImage.onerror = () => reject(new Error('Khong the raster hoa layer SVG.'));
                nextImage.src = imageUrl;
            });
        }

        targetCtx.save();
        targetCtx.scale(scale, scale);
        targetCtx.translate(-bounds.minX, -bounds.minY);
        targetCtx.drawImage(drawable, bounds.minX, bounds.minY, bounds.width, bounds.height);
        targetCtx.restore();
        return true;
    } catch (error) {
        console.warn('SVG raster preview fallback to shape-only:', error);
        return false;
    } finally {
        if (typeof drawable?.close === 'function') {
            drawable.close();
        }
        if (imageUrl) {
            URL.revokeObjectURL(imageUrl);
        }
    }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
