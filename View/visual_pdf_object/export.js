function exportToSVG() {
    if (!hasRenderableDocument()) {
        alert('No data to export.');
        return;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const paths = [];

    sortedLayerKeys.forEach(layerName => {
        if (!layerVisibility[layerName]) return;
        const layerArr = layerIndex[layerName] || [];
        layerArr.forEach(obj => {
            if (obj.type === 'text') return;
            if (obj.rect) {
                minX = Math.min(minX, obj.rect[0]);
                minY = Math.min(minY, obj.rect[1]);
                maxX = Math.max(maxX, obj.rect[2]);
                maxY = Math.max(maxY, obj.rect[3]);
            }
            if (!Array.isArray(obj.items)) return;
            obj.items.forEach(item => {
                const type = item[0];
                let pathData = '';
                if (type === 'l') {
                    const [x1, y1] = item[1];
                    const [x2, y2] = item[2];
                    pathData = `M ${x1} ${y1} L ${x2} ${y2}`;
                } else if (type === 'c') {
                    const [p0x, p0y] = item[1];
                    const [p1x, p1y] = item[2];
                    const [p2x, p2y] = item[3];
                    const [p3x, p3y] = item[4];
                    pathData = `M ${p0x} ${p0y} C ${p1x} ${p1y} ${p2x} ${p2y} ${p3x} ${p3y}`;
                } else if (type === 'qu') {
                    const points = item[1];
                    if (points?.length === 4) {
                        pathData = `M ${points[0][0]} ${points[0][1]} L ${points[1][0]} ${points[1][1]} L ${points[3][0]} ${points[3][1]} L ${points[2][0]} ${points[2][1]} Z`;
                    }
                }
                if (!pathData) return;
                const color = obj.color ? toRgbString(obj.color) : '#000';
                const width = obj.width || 1;
                paths.push(`<path d="${pathData}" stroke="${color}" stroke-width="${width}" fill="none"/>`);
            });
        });
    });

    if (!paths.length && !svgData) {
        alert('Khong co duong ve hoac SVG nao de xuat.');
        return;
    }

    const width = maxX - minX || 100;
    const height = maxY - minY || 100;
    let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" width="${width}" height="${height}">`;
    if (paths.length) svgContent += paths.join('\n');

    if (svgData && svgData.text_only && layerVisibility.svg_text) {
        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(svgData.text_only, 'image/svg+xml');
        const defs = svgDoc.querySelector('defs');
        if (defs) svgContent += new XMLSerializer().serializeToString(defs);
        svgDoc.querySelectorAll('use').forEach(use => {
            svgContent += new XMLSerializer().serializeToString(use);
        });
    }

    if (svgData && svgData.graphic_only && layerVisibility.svg_graphic) {
        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(svgData.graphic_only, 'image/svg+xml');
        const defs = svgDoc.querySelector('defs');
        if (defs) svgContent += new XMLSerializer().serializeToString(defs);
        Array.from(svgDoc.children)
            .filter(child => child.tagName !== 'defs')
            .forEach(child => {
                svgContent += new XMLSerializer().serializeToString(child);
            });
    }

    svgContent += '</svg>';
    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'exported_visual.svg';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

async function getPdfPageBounds() {
    if (!currentPdfFile || !currentPageNum) return null;

    let pdf = null;
    let page = null;
    try {
        const arrayBuffer = await currentPdfFile.arrayBuffer();
        pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        page = await pdf.getPage(currentPageNum);
        const viewport = page.getViewport({ scale: 1 });
        return {
            minX: 0,
            minY: 0,
            maxX: viewport.width,
            maxY: viewport.height,
            width: viewport.width,
            height: viewport.height
        };
    } catch (error) {
        console.warn('Failed to read PDF page bounds for export:', error);
        return null;
    } finally {
        if (page) {
            try { page.cleanup(); } catch (error) {}
        }
        if (pdf) {
            try { await pdf.destroy(); } catch (error) {}
        }
    }
}

async function getExportBounds(scale = CONFIG.MANUAL_LABEL_SCALE) {
    const pdfBounds = await getPdfPageBounds();
    if (pdfBounds) return pdfBounds;

    if (shapeRasterCache?.canvas && shapeRasterCache.canvas.width > 0 && shapeRasterCache.canvas.height > 0) {
        return {
            minX: shapeRasterCache.bounds.minX,
            minY: shapeRasterCache.bounds.minY,
            maxX: shapeRasterCache.bounds.maxX,
            maxY: shapeRasterCache.bounds.maxY,
            width: shapeRasterCache.bounds.width,
            height: shapeRasterCache.bounds.height
        };
    }

    if (documentMetadata && Array.isArray(documentMetadata.bbox_all) && documentMetadata.bbox_all.length === 4) {
        const [minX, minY, maxX, maxY] = documentMetadata.bbox_all;
        if ([minX, minY, maxX, maxY].every(Number.isFinite)) {
            return {
                minX,
                minY,
                maxX,
                maxY,
                width: maxX - minX,
                height: maxY - minY
            };
        }
    }

    const tightBounds = getRenderableLayerBounds();
    if (!tightBounds) return null;
    const padding = 2;
    return {
        minX: tightBounds.minX - padding,
        minY: tightBounds.minY - padding,
        maxX: tightBounds.maxX + padding,
        maxY: tightBounds.maxY + padding,
        width: (tightBounds.maxX - tightBounds.minX) + (padding * 2),
        height: (tightBounds.maxY - tightBounds.minY) + (padding * 2)
    };
}

function getRenderableLayerBounds() {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    sortedLayerKeys.forEach(layerName => {
        const layerArr = layerIndex[layerName] || [];
        layerArr.forEach(obj => {
            if (!obj.bbox) return;
            minX = Math.min(minX, obj.bbox.minX);
            minY = Math.min(minY, obj.bbox.minY);
            maxX = Math.max(maxX, obj.bbox.maxX);
            maxY = Math.max(maxY, obj.bbox.maxY);
        });
    });

    if (minX === Infinity) return null;
    return {
        minX,
        minY,
        maxX,
        maxY,
        width: maxX - minX,
        height: maxY - minY
    };
}

function getVisibleRenderableLayers() {
    return sortedLayerKeys.filter(layerName =>
        layerVisibility[layerName]
        && layerIndex[layerName]
        && layerIndex[layerName].length > 0
        && !layerName.startsWith('svg_')
        && !pipelineLayerNames.includes(layerName)
    );
}

function getCurrentExportBaseName() {
    const sourceName = (currentPdfFile && currentPdfFile.name)
        || (currentJsonSourceFile && (currentJsonSourceFile.name || currentJsonSourceFile))
        || 'visual_layers';
    return sourceName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_\-.]/g, '_');
}

function getSafeLayerFileName(layerName) {
    return String(layerName || 'layer').replace(/[^a-zA-Z0-9_\-.]/g, '_');
}

function createCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(width));
    canvas.height = Math.max(1, Math.ceil(height));
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    return { canvas, ctx };
}

function getCanvasColor(color) {
    if (!Array.isArray(color) || color.length < 3) return '#000000';
    const multiplier = Math.max(color[0], color[1], color[2]) > 1.5 ? 1 : 255;
    const red = Math.max(0, Math.min(255, Math.round(color[0] * multiplier)));
    const green = Math.max(0, Math.min(255, Math.round(color[1] * multiplier)));
    const blue = Math.max(0, Math.min(255, Math.round(color[2] * multiplier)));
    return `rgb(${red}, ${green}, ${blue})`;
}

function getExportLineWidth(width, scale) {
    const baseWidth = Number(width) || 1;
    return Math.max(1, Math.round(baseWidth * scale * 0.4));
}

function toExportCanvasPoint(point, bounds, scale) {
    return [
        (Number(point[0]) - bounds.minX) * scale,
        (Number(point[1]) - bounds.minY) * scale
    ];
}

function sampleCubicBezierPoints(p0, p1, p2, p3, segments = 20) {
    const points = [];
    for (let index = 0; index <= segments; index += 1) {
        const s = index / segments;
        const ms = 1 - s;
        const x = (ms ** 3 * p0[0]) + (3 * ms ** 2 * s * p1[0]) + (3 * ms * s ** 2 * p2[0]) + (s ** 3 * p3[0]);
        const y = (ms ** 3 * p0[1]) + (3 * ms ** 2 * s * p1[1]) + (3 * ms * s ** 2 * p2[1]) + (s ** 3 * p3[1]);
        points.push([x, y]);
    }
    return points;
}

function drawExportItemsOnCanvas(ctx, items, strokeStyle, lineWidth, fillStyle, scale, bounds) {
    if (!Array.isArray(items) || !items.length) return;
    ctx.strokeStyle = strokeStyle;
    ctx.fillStyle = fillStyle || strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';

    items.forEach(item => {
        if (!item) return;
        const type = item[0];

        if (type === 'l') {
            try {
                const [x1, y1] = toExportCanvasPoint(item[1], bounds, scale);
                const [x2, y2] = toExportCanvasPoint(item[2], bounds, scale);
                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();
            } catch (error) {}
            return;
        }

        if (type === 'c') {
            try {
                const sampledPoints = sampleCubicBezierPoints(item[1], item[2], item[3], item[4]).map(point =>
                    toExportCanvasPoint(point, bounds, scale)
                );
                if (!sampledPoints.length) return;
                ctx.beginPath();
                ctx.moveTo(sampledPoints[0][0], sampledPoints[0][1]);
                for (let index = 1; index < sampledPoints.length; index += 1) {
                    ctx.lineTo(sampledPoints[index][0], sampledPoints[index][1]);
                }
                ctx.stroke();
            } catch (error) {}
            return;
        }

        if (type === 're') {
            try {
                const [x, y, width, height] = item[1];
                const px = (x - bounds.minX) * scale;
                const py = (y - bounds.minY) * scale;
                const pw = width * scale;
                const ph = height * scale;
                if (fillStyle) {
                    ctx.fillRect(px, py, pw, ph);
                }
                ctx.strokeRect(px, py, pw, ph);
            } catch (error) {}
        }
    });
}

function renderLayerOnExportCanvas(targetCtx, targetCanvas, layerName, bounds, scale) {
    targetCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
    targetCtx.fillStyle = '#ffffff';
    targetCtx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);

    const layerArr = layerIndex[layerName] || [];
    layerArr.forEach(obj => {
        if (!obj || obj.type === 'text') return;
        drawExportItemsOnCanvas(
            targetCtx,
            obj.items || [],
            getCanvasColor(obj.color),
            getExportLineWidth(obj.width, scale),
            obj.fill ? getCanvasColor(obj.fill) : null,
            scale,
            bounds
        );
    });
}

function canvasToBase64(canvas, mimeType = 'image/png', quality) {
    return canvas.toDataURL(mimeType, quality).split(',')[1];
}

function saveCanvasToZip(zip, path, canvas, mimeType = 'image/jpeg', quality = 0.95) {
    zip.file(path, canvasToBase64(canvas, mimeType, quality), { base64: true });
}

function worldPolygonToPixelPolygon(worldPolygon, bounds, scale) {
    return worldPolygon.map(point => [
        (point.x - bounds.minX) * scale,
        (point.y - bounds.minY) * scale
    ]);
}

function clipObbToRect(points, width, height) {
    function clip(poly, keep, cut) {
        if (!poly.length) return [];
        const output = [];
        for (let index = 0; index < poly.length; index += 1) {
            const current = poly[index];
            const previous = poly[(index + poly.length - 1) % poly.length];
            const keepCurrent = keep(current);
            const keepPrevious = keep(previous);
            if (keepCurrent) {
                if (!keepPrevious) {
                    output.push(cut(previous, current));
                }
                output.push(current);
            } else if (keepPrevious) {
                output.push(cut(previous, current));
            }
        }
        return output;
    }

    function cutHorizontal(yLine) {
        return (pointA, pointB) => {
            const dy = pointB[1] - pointA[1];
            const t = Math.abs(dy) < 1e-12 ? 0 : ((yLine - pointA[1]) / dy);
            return [pointA[0] + (t * (pointB[0] - pointA[0])), yLine];
        };
    }

    function cutVertical(xLine) {
        return (pointA, pointB) => {
            const dx = pointB[0] - pointA[0];
            const t = Math.abs(dx) < 1e-12 ? 0 : ((xLine - pointA[0]) / dx);
            return [xLine, pointA[1] + (t * (pointB[1] - pointA[1]))];
        };
    }

    let polygon = points.map(point => [Number(point[0]), Number(point[1])]);
    polygon = clip(polygon, point => point[1] >= 0, cutHorizontal(0));
    polygon = clip(polygon, point => point[0] <= width, cutVertical(width));
    polygon = clip(polygon, point => point[1] <= height, cutHorizontal(height));
    polygon = clip(polygon, point => point[0] >= 0, cutVertical(0));
    if (polygon.length < 3) return null;

    const [p0, p1, , p3] = points;
    let ux = p1[0] - p0[0];
    let uy = p1[1] - p0[1];
    let vx = p3[0] - p0[0];
    let vy = p3[1] - p0[1];
    const uLength = Math.hypot(ux, uy);
    const vLength = Math.hypot(vx, vy);
    if (uLength < 1e-6 || vLength < 1e-6) return null;

    ux /= uLength;
    uy /= uLength;
    vx /= vLength;
    vy /= vLength;

    const uValues = polygon.map(point => ((point[0] - p0[0]) * ux) + ((point[1] - p0[1]) * uy));
    const vValues = polygon.map(point => ((point[0] - p0[0]) * vx) + ((point[1] - p0[1]) * vy));
    const uMin = Math.min(...uValues);
    const uMax = Math.max(...uValues);
    const vMin = Math.min(...vValues);
    const vMax = Math.max(...vValues);

    return [
        [p0[0] + (uMin * ux) + (vMin * vx), p0[1] + (uMin * uy) + (vMin * vy)],
        [p0[0] + (uMax * ux) + (vMin * vx), p0[1] + (uMax * uy) + (vMin * vy)],
        [p0[0] + (uMax * ux) + (vMax * vx), p0[1] + (uMax * uy) + (vMax * vy)],
        [p0[0] + (uMin * ux) + (vMax * vx), p0[1] + (uMin * uy) + (vMax * vy)]
    ];
}

function getObbEdgeLengths(points) {
    return {
        u: Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1]),
        v: Math.hypot(points[3][0] - points[0][0], points[3][1] - points[0][1])
    };
}

function getObbArea(points) {
    const edges = getObbEdgeLengths(points);
    return edges.u * edges.v;
}

function getPolygonCenter(points) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    points.forEach(point => {
        minX = Math.min(minX, point[0]);
        minY = Math.min(minY, point[1]);
        maxX = Math.max(maxX, point[0]);
        maxY = Math.max(maxY, point[1]);
    });
    return {
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2
    };
}

function formatYoloObbLine(classId, points, imageWidth, imageHeight) {
    const flat = points.map(point => `${(point[0] / imageWidth).toFixed(6)} ${(point[1] / imageHeight).toFixed(6)}`).join(' ');
    return `${classId} ${flat}`;
}

function buildYoloLabelText(entries, imageWidth, imageHeight) {
    return entries.map(entry => formatYoloObbLine(entry.classId, entry.points, imageWidth, imageHeight)).join('\n');
}

function getExportAnnotationEntries(layerName, bounds, imageWidth, imageHeight, scale) {
    const entries = [];
    manualAnnotations
        .filter(annotation => annotation.layerName === layerName)
        .forEach(annotation => {
            const worldPolygon = getManualAnnotationWorldPolygon(annotation);
            if (!worldPolygon) return;
            const pixelPolygon = worldPolygonToPixelPolygon(worldPolygon, bounds, scale);
            const clipped = clipObbToRect(pixelPolygon, imageWidth, imageHeight);
            if (!clipped) return;
            const edges = getObbEdgeLengths(clipped);
            if (edges.u <= 1e-6 || edges.v <= 1e-6) return;
            entries.push({
                classId: CONFIG.MANUAL_LABEL_CLASSES[annotation.type],
                labelName: annotation.type,
                points: clipped,
                area: edges.u * edges.v
            });
        });
    return entries;
}

function renderLayersOnExportCanvas(targetCtx, targetCanvas, layerNames, bounds, scale) {
    targetCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
    targetCtx.fillStyle = '#ffffff';
    targetCtx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);

    layerNames.forEach(layerName => {
        const layerArr = layerIndex[layerName] || [];
        layerArr.forEach(obj => {
            if (!obj || obj.type === 'text') return;
            drawExportItemsOnCanvas(
                targetCtx,
                obj.items || [],
                getCanvasColor(obj.color),
                getExportLineWidth(obj.width, scale),
                obj.fill ? getCanvasColor(obj.fill) : null,
                scale,
                bounds
            );
        });
    });
}

function getMergedExportAnnotationEntries(bounds, imageWidth, imageHeight, scale) {
    const entries = [];
    manualAnnotations.forEach(annotation => {
        if (!annotation?.layerName || !isExportableAnnotationLayer(annotation.layerName)) return;
        const worldPolygon = getManualAnnotationWorldPolygon(annotation);
        if (!worldPolygon) return;
        const pixelPolygon = worldPolygonToPixelPolygon(worldPolygon, bounds, scale);
        const clipped = clipObbToRect(pixelPolygon, imageWidth, imageHeight);
        if (!clipped) return;
        const edges = getObbEdgeLengths(clipped);
        if (edges.u <= 1e-6 || edges.v <= 1e-6) return;
        entries.push({
            classId: CONFIG.MANUAL_LABEL_CLASSES[annotation.type],
            labelName: annotation.type,
            points: clipped,
            area: edges.u * edges.v
        });
    });
    return entries;
}

function drawObbPolygon(targetCtx, points) {
    if (!Array.isArray(points) || !points.length) return;
    targetCtx.beginPath();
    targetCtx.moveTo(points[0][0], points[0][1]);
    for (let index = 1; index < points.length; index += 1) {
        targetCtx.lineTo(points[index][0], points[index][1]);
    }
    targetCtx.closePath();
}

function drawAnnotationEntriesOnCanvas(targetCtx, entries, options = {}) {
    const colorMap = {
        junction: 'rgb(255, 0, 0)',
        connect: 'rgb(0, 200, 0)'
    };
    const labelColorMap = {
        junction: '#ff0000',
        connect: '#00c800'
    };
    const lineWidth = options.lineWidth || 2;
    const showText = Boolean(options.showText);

    entries.forEach(entry => {
        const color = colorMap[entry.labelName] || '#000000';
        targetCtx.strokeStyle = color;
        targetCtx.lineWidth = lineWidth;
        targetCtx.lineJoin = 'round';
        drawObbPolygon(targetCtx, entry.points);
        targetCtx.stroke();
        if (!showText) return;
        targetCtx.fillStyle = labelColorMap[entry.labelName] || '#000000';
        targetCtx.font = '16px Arial';
        targetCtx.fillText(entry.labelName, entry.points[0][0] + 4, entry.points[0][1] + 16);
    });
}

function createVisualCanvas(sourceCanvas, entries, options = {}) {
    const { canvas, ctx } = createCanvas(sourceCanvas.width, sourceCanvas.height);
    ctx.drawImage(sourceCanvas, 0, 0);
    drawAnnotationEntriesOnCanvas(ctx, entries, options);
    return canvas;
}

function buildCropEntries(entries, cropX, cropY, cropSize, options = {}) {
    const results = [];
    const minBBoxSize = options.minBBoxSize ?? CONFIG.MANUAL_LABEL_MIN_BBOX_SIZE;
    const junctionAreaThreshold = options.junctionAreaThreshold ?? CONFIG.MANUAL_LABEL_CROP_AREA_THRESHOLD_JUNCTION;

    entries.forEach(entry => {
        const shifted = entry.points.map(point => [point[0] - cropX, point[1] - cropY]);
        const clipped = clipObbToRect(shifted, cropSize, cropSize);
        if (!clipped) return;

        const edges = getObbEdgeLengths(clipped);
        if (edges.u < minBBoxSize || edges.v < minBBoxSize) return;

        const clippedArea = edges.u * edges.v;
        if (entry.labelName === 'junction' && clippedArea < (entry.area * junctionAreaThreshold)) return;

        results.push({
            classId: entry.classId,
            labelName: entry.labelName,
            points: clipped,
            area: clippedArea
        });
    });

    return results;
}

function transformAugmentedEntries(entries, transformPoints, imageWidth, imageHeight, minBBoxSize) {
    const results = [];
    entries.forEach(entry => {
        const transformed = transformPoints(entry.points);
        const clipped = clipObbToRect(transformed, imageWidth, imageHeight);
        if (!clipped) return;
        const edges = getObbEdgeLengths(clipped);
        if (edges.u < minBBoxSize || edges.v < minBBoxSize) return;
        results.push({
            classId: entry.classId,
            labelName: entry.labelName,
            points: clipped,
            area: edges.u * edges.v
        });
    });
    return results;
}

function getRandomIntInclusive(minimum, maximum) {
    const min = Math.ceil(minimum);
    const max = Math.floor(maximum);
    if (max <= min) return min;
    return Math.floor(Math.random() * ((max - min) + 1)) + min;
}

function shuffleArray(values) {
    for (let index = values.length - 1; index > 0; index -= 1) {
        const randomIndex = Math.floor(Math.random() * (index + 1));
        [values[index], values[randomIndex]] = [values[randomIndex], values[index]];
    }
    return values;
}

function extractCanvasCrop(sourceCanvas, cropX, cropY, cropSize) {
    const { canvas, ctx } = createCanvas(cropSize, cropSize);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cropSize, cropSize);
    ctx.drawImage(sourceCanvas, cropX, cropY, cropSize, cropSize, 0, 0, cropSize, cropSize);
    return canvas;
}

function createAugmentedCanvas(sourceCanvas, options = {}) {
    const width = sourceCanvas.width;
    const height = sourceCanvas.height;
    const { canvas, ctx } = createCanvas(width, height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(options.flipLR ? -1 : 1, options.flipUD ? -1 : 1);
    if (options.angleRad) {
        ctx.rotate(options.angleRad);
    }
    ctx.drawImage(sourceCanvas, -width / 2, -height / 2);
    ctx.restore();
    return canvas;
}

function buildCropSplitArray(numCrops, trainRatio) {
    const numTrainCrops = Math.floor(numCrops * trainRatio);
    const numValidCrops = numCrops - numTrainCrops;
    const splitArray = [
        ...Array(numTrainCrops).fill(true),
        ...Array(numValidCrops).fill(false)
    ];
    return shuffleArray(splitArray);
}

async function exportLayerImages() {
    if (!jsonShapes || !sortedLayerKeys.length) {
        alert('Khong co du lieu de xuat.');
        return;
    }

    const scale = CONFIG.MANUAL_LABEL_SCALE;
    const bounds = await getExportBounds(scale);
    if (!bounds) {
        alert('Khong tinh duoc vung ve.');
        return;
    }

    const { canvas, ctx } = createCanvas(bounds.width * scale, bounds.height * scale);
    const popup = document.getElementById('loading-popup');
    if (popup) popup.style.display = 'flex';

    try {
        const zip = new JSZip();
        const visibleLayers = getVisibleRenderableLayers();
        visibleLayers.forEach(layerName => {
            renderLayerOnExportCanvas(ctx, canvas, layerName, bounds, scale);
            zip.file(`layers/${getSafeLayerFileName(layerName)}.png`, canvasToBase64(canvas, 'image/png'), { base64: true });
        });

        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const zipUrl = URL.createObjectURL(zipBlob);
        const anchor = document.createElement('a');
        anchor.href = zipUrl;
        anchor.download = 'layers_export.zip';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(zipUrl);
    } finally {
        if (popup) popup.style.display = 'none';
    }
}

async function exportAnnotatedLayerPackage() {
    if (!jsonShapes || !jsonShapes.length) {
        alert('Khong co du lieu de xuat.');
        return;
    }

    if (!manualAnnotations.length) {
        alert('Chua co nhan thu cong de xuat.');
        return;
    }

    const scale = CONFIG.MANUAL_LABEL_SCALE;
    const bounds = await getExportBounds(scale);
    if (!bounds) {
        alert('Khong tinh duoc vung ve de export.');
        return;
    }

    const annotatedLayerNames = new Set(
        manualAnnotations
            .map(annotation => annotation.layerName)
            .filter(layerName => isExportableAnnotationLayer(layerName))
    );
    const exportLayers = sortedLayerKeys.filter(layerName => annotatedLayerNames.has(layerName));
    if (!exportLayers.length) {
        alert('Khong co layer dang hien thi nao chua nhan de export.');
        return;
    }

    const popup = document.getElementById('loading-popup');
    if (popup) popup.style.display = 'flex';

    try {
        const { canvas: pageCanvas, ctx: pageCtx } = createCanvas(bounds.width * scale, bounds.height * scale);
        renderLayersOnExportCanvas(pageCtx, pageCanvas, exportLayers, bounds, scale);

        const entries = getMergedExportAnnotationEntries(bounds, pageCanvas.width, pageCanvas.height, scale);
        if (!entries.length) {
            alert('Khong tao duoc label hop le de export.');
            return;
        }

        const zip = new JSZip();
        const exportBaseName = getCurrentExportBaseName();
        const pageSuffix = currentPageNum ? `_p${currentPageNum}` : '';
        const stem = `${exportBaseName}${pageSuffix}`;

        saveCanvasToZip(zip, `${stem}.jpg`, pageCanvas, 'image/jpeg', 0.95);
        zip.file(`${stem}.txt`, buildYoloLabelText(entries, pageCanvas.width, pageCanvas.height));

        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const zipUrl = URL.createObjectURL(zipBlob);
        const anchor = document.createElement('a');
        anchor.href = zipUrl;
        anchor.download = `${stem}_labels.zip`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(zipUrl);

        if (typeof setAnnotationFeedback === 'function') {
            setAnnotationFeedback(`Da export 1 anh JPG va 1 file TXT nhan.`, 'info');
        }
    } finally {
        if (popup) popup.style.display = 'none';
    }
}