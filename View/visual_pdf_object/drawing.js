// drawing.js
function addShapeToPath(targetCtx, shape) {
    // Add shape geometry to current path WITHOUT calling beginPath()
    if (!shape.items) return;
    let started = false, cx, cy;
    shape.items.forEach(item => {
        const type = item[0];
        if (type === 'l') {
            const [sx, sy] = item[1], [ex, ey] = item[2];
            if (!started) { targetCtx.moveTo(sx, sy); started = true; }
            else if (cx !== sx || cy !== sy) targetCtx.moveTo(sx, sy);
            targetCtx.lineTo(ex, ey);
            cx = ex; cy = ey;
        } else if (type === 'c') {
            const [p0x, p0y] = item[1], [p1x, p1y] = item[2], [p2x, p2y] = item[3], [p3x, p3y] = item[4];
            if (!started) { targetCtx.moveTo(p0x, p0y); started = true; }
            else if (cx !== p0x || cy !== p0y) targetCtx.moveTo(p0x, p0y);
            targetCtx.bezierCurveTo(p1x, p1y, p2x, p2y, p3x, p3y);
            cx = p3x; cy = p3y;
        } else if (type === 'qu') {
            const points = item[1];
            if (points?.length === 4) {
                const [q0x, q0y] = points[0];
                if (!started) { targetCtx.moveTo(q0x, q0y); started = true; }
                else if (cx !== q0x || cy !== q0y) targetCtx.moveTo(q0x, q0y);
                targetCtx.lineTo(points[1][0], points[1][1]);
                targetCtx.lineTo(points[3][0], points[3][1]);
                targetCtx.lineTo(points[2][0], points[2][1]);
                targetCtx.closePath();
                cx = q0x; cy = q0y;
            }
        } else if (type === 'poly') {
            const points = item[1];
            if (points?.length > 0) {
                const [q0x, q0y] = points[0];
                if (!started) { targetCtx.moveTo(q0x, q0y); started = true; }
                else if (cx !== q0x || cy !== q0y) targetCtx.moveTo(q0x, q0y);
                for (let i = 1; i < points.length; i++) {
                    targetCtx.lineTo(points[i][0], points[i][1]);
                }
                targetCtx.closePath();
                cx = q0x; cy = q0y;
            }
        }
    });
    if (shape.closePath) targetCtx.closePath();
}
function buildShapePath(targetCtx, shape) {
    targetCtx.beginPath();
    if (!shape.items) return;
    let started = false, cx, cy;
    shape.items.forEach(item => {
        const type = item[0];
        if (type === 'l') {
            const [sx, sy] = item[1], [ex, ey] = item[2];
            if (!started) { targetCtx.moveTo(sx, sy); started = true; }
            else if (cx !== sx || cy !== sy) targetCtx.moveTo(sx, sy);
            targetCtx.lineTo(ex, ey);
            cx = ex; cy = ey;
        } else if (type === 'c') {
            const [p0x, p0y] = item[1], [p1x, p1y] = item[2], [p2x, p2y] = item[3], [p3x, p3y] = item[4];
            if (!started) { targetCtx.moveTo(p0x, p0y); started = true; }
            else if (cx !== p0x || cy !== p0y) targetCtx.moveTo(p0x, p0y);
            targetCtx.bezierCurveTo(p1x, p1y, p2x, p2y, p3x, p3y);
            cx = p3x; cy = p3y;
        } else if (type === 'qu') {
            const points = item[1];
            if (points?.length === 4) {
                const [q0x, q0y] = points[0];
                if (!started) { targetCtx.moveTo(q0x, q0y); started = true; }
                else if (cx !== q0x || cy !== q0y) targetCtx.moveTo(q0x, q0y);
                targetCtx.lineTo(points[1][0], points[1][1]);
                targetCtx.lineTo(points[3][0], points[3][1]);
                targetCtx.lineTo(points[2][0], points[2][1]);
                targetCtx.closePath();
                cx = q0x; cy = q0y;
            }
        } else if (type === 'poly') {
            const points = item[1];
            if (points?.length > 0) {
                const [q0x, q0y] = points[0];
                if (!started) { targetCtx.moveTo(q0x, q0y); started = true; }
                else if (cx !== q0x || cy !== q0y) targetCtx.moveTo(q0x, q0y);
                for (let i = 1; i < points.length; i++) {
                    targetCtx.lineTo(points[i][0], points[i][1]);
                }
                targetCtx.closePath();
                cx = q0x; cy = q0y;
            }
        }
    });
    if (shape.closePath) targetCtx.closePath();
}
function strokeShapeItems(targetCtx, shape) {
    if (!shape.color || !shape.items) return;
    targetCtx.strokeStyle = shape._strokeStyle || toRgbString(shape.color);
    targetCtx.lineWidth = shape._effectiveWidth || getEffectiveWidth(shape.width);
    targetCtx.beginPath();
    shape.items.forEach(item => {
        const type = item[0];
        if (type === 'l') {
            targetCtx.moveTo(item[1][0], item[1][1]);
            targetCtx.lineTo(item[2][0], item[2][1]);
        } else if (type === 'c') {
            targetCtx.moveTo(item[1][0], item[1][1]);
            targetCtx.bezierCurveTo(item[2][0], item[2][1], item[3][0], item[3][1], item[4][0], item[4][1]);
        } else if (type === 'qu') {
            const points = item[1];
            if (points?.length === 4) {
                targetCtx.moveTo(points[0][0], points[0][1]);
                targetCtx.lineTo(points[1][0], points[1][1]);
                targetCtx.lineTo(points[3][0], points[3][1]);
                targetCtx.lineTo(points[2][0], points[2][1]);
                targetCtx.closePath();
            }
        } else if (type === 'poly') {
            const points = item[1];
            if (points?.length > 0) {
                targetCtx.moveTo(points[0][0], points[0][1]);
                for (let i = 1; i < points.length; i++) {
                    targetCtx.lineTo(points[i][0], points[i][1]);
                }
                targetCtx.closePath();
            }
        }
    });
    targetCtx.stroke();
}
function drawShapeOnCtx(targetCtx, shape) {
    if (shape.fill) {
        buildShapePath(targetCtx, shape);
        targetCtx.fillStyle = shape._fillStyle || toRgbString(shape.fill);
        targetCtx.fill();
    }
    strokeShapeItems(targetCtx, shape);
}
function drawShapeOnCtxWithColor(targetCtx, shape, overrideColor) {
    if (shape.fill) {
        buildShapePath(targetCtx, shape);
        targetCtx.fillStyle = toRgbString(overrideColor);
        targetCtx.fill();
    }
    if (!shape.color || !shape.items) return;
    targetCtx.strokeStyle = toRgbString(overrideColor);
    targetCtx.lineWidth = getEffectiveWidth(shape.width);
    targetCtx.beginPath();
    shape.items.forEach(item => {
        const type = item[0];
        if (type === 'l') {
            targetCtx.moveTo(item[1][0], item[1][1]);
            targetCtx.lineTo(item[2][0], item[2][1]);
        } else if (type === 'c') {
            targetCtx.moveTo(item[1][0], item[1][1]);
            targetCtx.bezierCurveTo(item[2][0], item[2][1], item[3][0], item[3][1], item[4][0], item[4][1]);
        } else if (type === 'qu') {
            const points = item[1];
            if (points?.length === 4) {
                targetCtx.moveTo(points[0][0], points[0][1]);
                targetCtx.lineTo(points[1][0], points[1][1]);
                targetCtx.lineTo(points[3][0], points[3][1]);
                targetCtx.lineTo(points[2][0], points[2][1]);
                targetCtx.closePath();
            }
        } else if (type === 'poly') {
            const points = item[1];
            if (points?.length > 0) {
                targetCtx.moveTo(points[0][0], points[0][1]);
                for (let i = 1; i < points.length; i++) {
                    targetCtx.lineTo(points[i][0], points[i][1]);
                }
                targetCtx.closePath();
            }
        }
    });
    targetCtx.stroke();
}

const SHAPE_RASTER_CACHE_MIN_SHAPES = 1;
const DEFAULT_LOW_ZOOM_RASTER_THRESHOLD = 2;
const SHAPE_RASTER_SCALE_EPSILON = 0.001;
const SHAPE_RASTER_CACHE_MAX_SIDE = 12288;
const SHAPE_RASTER_CACHE_MAX_PIXELS = 72 * 1024 * 1024;
const SHAPE_RASTER_BUILD_YIELD_EVERY = 8000;

let shapeRasterCache = null;
let shapeRasterCacheBuildScheduled = false;
let shapeRasterCacheToken = 0;
let shapeRasterCacheBuildPromise = null;
let shapeRasterPreviewMountedCanvas = null;
let crosshairOverlayVisible = false;

function getShapeRasterCacheTargetScale() {
    if (currentPdfFile && Number.isFinite(CONFIG?.PDF_PAGE_CACHE_SCALE)) {
        return CONFIG.PDF_PAGE_CACHE_SCALE;
    }
    if (Number.isFinite(CONFIG?.JSON_RASTER_CACHE_SCALE)) {
        return CONFIG.JSON_RASTER_CACHE_SCALE;
    }
    return Number.isFinite(CONFIG?.PDF_PAGE_CACHE_SCALE) ? CONFIG.PDF_PAGE_CACHE_SCALE : 3;
}

function formatRasterScale(scale) {
    if (!Number.isFinite(scale) || scale <= 0) return '1';
    const roundedInteger = Math.round(scale);
    if (Math.abs(scale - roundedInteger) < SHAPE_RASTER_SCALE_EPSILON) {
        return String(roundedInteger);
    }
    return scale.toFixed(2);
}

function hasVisibleSvgRasterLayers() {
    return Boolean(
        ((layerVisibility?.['svg_text'] !== false) && svgData?.text_only) ||
        ((layerVisibility?.['svg_graphic'] !== false) && svgData?.graphic_only)
    );
}

function shouldPrepareShapeRasterCache() {
    return Boolean(
        (
            (allShapesSorted && allShapesSorted.length >= SHAPE_RASTER_CACHE_MIN_SHAPES) ||
            hasVisibleSvgRasterLayers()
        )
    );
}

function getLowZoomRasterThreshold() {
    return Number.isFinite(CONFIG?.LOW_ZOOM_RASTER_THRESHOLD)
        ? CONFIG.LOW_ZOOM_RASTER_THRESHOLD
        : DEFAULT_LOW_ZOOM_RASTER_THRESHOLD;
}

function shouldPreferShapeRasterPreview() {
    return zoom <= getLowZoomRasterThreshold();
}

function getActiveRasterPreviewSource() {
    return shapeRasterCache;
}

function isActiveRasterPreviewPending() {
    return Boolean(shapeRasterCacheBuildScheduled || shapeRasterCacheBuildPromise);
}

function scheduleActiveRasterPreviewBuild() {
    scheduleShapeRasterCacheBuild();
}

function updateZoomIndicator(preferRasterPreview = shouldPreferShapeRasterPreview()) {
    if (!zoomIndicator) return;

    let renderMode = 'vector';
    let renderLabel = 'Vector';

    if (preferRasterPreview) {
        const rasterPreviewSource = getActiveRasterPreviewSource();
        if (rasterPreviewSource) {
            renderMode = 'raster';
            renderLabel = `Raster x${formatRasterScale(rasterPreviewSource.scale || getShapeRasterCacheTargetScale())}`;
        } else if (isActiveRasterPreviewPending()) {
            renderMode = 'building';
            renderLabel = `Raster x${formatRasterScale(getShapeRasterCacheTargetScale())} (building)`;
        }
    }

    const nextLabel = `Zoom ${zoom.toFixed(2)}x | ${renderLabel}`;
    if (zoomIndicator.textContent !== nextLabel) {
        zoomIndicator.textContent = nextLabel;
    }
    if (zoomIndicator.dataset.renderMode !== renderMode) {
        zoomIndicator.dataset.renderMode = renderMode;
    }
}

function resetZoomIndicator() {
    if (!zoomIndicator) return;
    zoomIndicator.textContent = 'Zoom 1.00x | Vector';
    zoomIndicator.dataset.renderMode = 'vector';
}

function hideShapeRasterPreview() {
    if (shapeRasterLayer) {
        shapeRasterLayer.style.display = 'none';
    }
    if (canvas) {
        canvas.classList.remove('is-raster-preview');
    }
}

function mountShapeRasterPreview(previewSource = getActiveRasterPreviewSource()) {
    if (!shapeRasterLayer || !previewSource?.canvas) return false;
    if (shapeRasterPreviewMountedCanvas !== previewSource.canvas) {
        shapeRasterLayer.replaceChildren(previewSource.canvas);
        shapeRasterPreviewMountedCanvas = previewSource.canvas;
    }
    return true;
}

function applyShapeRasterPreviewTransform(previewSource = getActiveRasterPreviewSource()) {
    if (!shapeRasterLayer || !previewSource || !mountShapeRasterPreview(previewSource)) return false;

    const rasterCanvas = previewSource.canvas;
    const rasterScale = previewSource.scale || 1;
    const screenScale = zoom / rasterScale;
    const translateX = offsetX + (previewSource.bounds.minX * zoom);
    const translateY = offsetY + (previewSource.bounds.minY * zoom);

    rasterCanvas.style.transform = `translate(${translateX}px, ${translateY}px) scale(${screenScale})`;
    shapeRasterLayer.style.display = 'block';
    return true;
}

function updateRenderSurfaceMode(preferRasterPreview = shouldPreferShapeRasterPreview()) {
    if (canvas) {
        canvas.classList.toggle('is-raster-preview', preferRasterPreview);
    }

    if (shapeRasterLayer) {
        if (shapeRasterLayer.childElementCount > 0) {
            shapeRasterLayer.replaceChildren();
        }
        shapeRasterPreviewMountedCanvas = null;
        shapeRasterLayer.style.display = preferRasterPreview ? 'block' : 'none';
    }

    return false;
}

function invalidateShapeRasterCache() {
    shapeRasterCache = null;
    shapeRasterCacheToken += 1;
    shapeRasterCacheBuildScheduled = false;
    shapeRasterPreviewMountedCanvas = null;
    hideShapeRasterPreview();
}

function getShapeRasterScaleForBounds(bounds, requestedScale) {
    if (!bounds) return 0;

    const sideScale = Math.min(
        requestedScale,
        SHAPE_RASTER_CACHE_MAX_SIDE / bounds.width,
        SHAPE_RASTER_CACHE_MAX_SIDE / bounds.height
    );
    const pixelScale = Math.min(
        requestedScale,
        Math.sqrt(SHAPE_RASTER_CACHE_MAX_PIXELS / (bounds.width * bounds.height))
    );

    return Math.max(0.01, Math.min(requestedScale, sideScale, pixelScale));
}

function getNextShapeRasterBuildPlan() {
    const bounds = getShapeRasterCacheBounds();
    if (!bounds) return null;

    const currentScale = shapeRasterCache?.scale || 0;
    const targetRequestedScale = getShapeRasterCacheTargetScale();
    const targetScale = getShapeRasterScaleForBounds(bounds, targetRequestedScale);
    if (currentScale + SHAPE_RASTER_SCALE_EPSILON < targetScale) {
        return { bounds, requestedScale: targetRequestedScale, rasterScale: targetScale };
    }

    return null;
}

function getShapeRasterCacheBounds() {
    let bounds = null;

    if (Array.isArray(documentMetadata?.bbox_all) && documentMetadata.bbox_all.length === 4) {
        const [minX, minY, maxX, maxY] = documentMetadata.bbox_all;
        if ([minX, minY, maxX, maxY].every(Number.isFinite)) {
            bounds = {
                minX,
                minY,
                maxX,
                maxY,
                width: Math.max(1, maxX - minX),
                height: Math.max(1, maxY - minY)
            };
        }
    }

    if (typeof mergeBounds === 'function') {
        bounds = mergeBounds(
            bounds,
            mergeBounds(
                layerVisibility?.['svg_text'] !== false ? extractSvgViewBoxBounds(svgData?.text_only) : null,
                layerVisibility?.['svg_graphic'] !== false ? extractSvgViewBoxBounds(svgData?.graphic_only) : null
            )
        );
    }

    for (const obj of allShapesSorted || []) {
        if (!obj.bbox || !layerVisibility[obj.layer]) continue;
        bounds = typeof mergeBounds === 'function'
            ? mergeBounds(bounds, obj.bbox)
            : bounds;
    }

    if (!bounds) {
        return null;
    }

    return bounds;
}

function drawShapeRasterCache(targetCtx) {
    if (!shapeRasterCache) return false;
    targetCtx.drawImage(
        shapeRasterCache.canvas,
        shapeRasterCache.bounds.minX,
        shapeRasterCache.bounds.minY,
        shapeRasterCache.bounds.width,
        shapeRasterCache.bounds.height
    );
    return true;
}

function drawRasterPreviewOnCtx(targetCtx, previewSource = getActiveRasterPreviewSource()) {
    if (!previewSource?.canvas || !previewSource.bounds) return false;

    targetCtx.drawImage(
        previewSource.canvas,
        previewSource.bounds.minX,
        previewSource.bounds.minY,
        previewSource.bounds.width,
        previewSource.bounds.height
    );
    return true;
}

function isShapeVisibleInView(obj, minX, minY, maxX, maxY, padding = 0) {
    if (!obj?.bbox) return true;
    return !(
        obj.bbox.maxX + padding < minX ||
        obj.bbox.minX - padding > maxX ||
        obj.bbox.maxY + padding < minY ||
        obj.bbox.minY - padding > maxY
    );
}

function getVisibleShapesForView(viewMinX, viewMinY, viewMaxX, viewMaxY, viewportPadding) {
    if (!allShapesSorted?.length) {
        return [];
    }

    const paddedMinX = viewMinX - viewportPadding;
    const paddedMinY = viewMinY - viewportPadding;
    const paddedMaxX = viewMaxX + viewportPadding;
    const paddedMaxY = viewMaxY + viewportPadding;

    if (!shapeQuadtree && typeof rebuildQuadtree === 'function') {
        rebuildQuadtree();
    }

    shapesDrawBuffer.length = 0;

    if (shapeQuadtree) {
        shapeQuadtree.query({
            minX: paddedMinX,
            minY: paddedMinY,
            maxX: paddedMaxX,
            maxY: paddedMaxY
        }, shapesDrawBuffer);
        sortShapesForDraw(shapesDrawBuffer);
        return shapesDrawBuffer;
    }

    allShapesSorted.forEach(obj => {
        const padding = obj?._effectiveWidth || obj?.width || 2;
        if (isShapeVisibleInView(obj, paddedMinX, paddedMinY, paddedMaxX, paddedMaxY, padding)) {
            shapesDrawBuffer.push(obj);
        }
    });
    return shapesDrawBuffer;
}

async function renderShapesToContextBatched(targetCtx, shapes, {
    token = null,
    yieldEvery = 0
} = {}) {
    if (!targetCtx || !Array.isArray(shapes) || shapes.length === 0) {
        return true;
    }

    let currentStrokeStyle = null;
    let currentLineWidth = null;
    let strokePending = false;
    let currentFillStyle = null;
    let fillPending = false;

    function flushFills(resetStyle = false) {
        if (fillPending) {
            targetCtx.fillStyle = currentFillStyle;
            targetCtx.fill();
            fillPending = false;
        }
        if (resetStyle) {
            currentFillStyle = null;
        }
    }

    function flushStrokes(resetStyle = false) {
        if (strokePending) {
            targetCtx.strokeStyle = currentStrokeStyle;
            targetCtx.lineWidth = currentLineWidth;
            targetCtx.stroke();
            strokePending = false;
        }
        if (resetStyle) {
            currentStrokeStyle = null;
            currentLineWidth = null;
        }
    }

    for (let index = 0; index < shapes.length; index++) {
        if (token !== null && token !== shapeRasterCacheToken) {
            flushFills(true);
            flushStrokes(true);
            return false;
        }

        const obj = shapes[index];
        if (!obj?.items || !layerVisibility[obj.layer]) continue;

        if (obj.fill) {
            const fillStyle = obj._fillStyle || toRgbString(obj.fill);
            if (currentFillStyle !== fillStyle || strokePending) {
                flushFills();
                flushStrokes();
                currentFillStyle = fillStyle;
                targetCtx.beginPath();
            }
            addShapeToPath(targetCtx, obj);
            fillPending = true;
        }

        if (obj.color) {
            const strokeStyle = obj._strokeStyle || toRgbString(obj.color);
            const lineWidth = obj._effectiveWidth || getEffectiveWidth(obj.width);
            if (currentStrokeStyle !== strokeStyle || currentLineWidth !== lineWidth || fillPending) {
                flushFills();
                flushStrokes();
                currentStrokeStyle = strokeStyle;
                currentLineWidth = lineWidth;
                targetCtx.beginPath();
            }
            addShapeToPath(targetCtx, obj);
            strokePending = true;
        }

        if (yieldEvery > 0 && index > 0 && index % yieldEvery === 0) {
            flushFills(true);
            flushStrokes(true);
            await yieldToBrowser();
        }
    }

    flushFills(true);
    flushStrokes(true);
    return token === null || token === shapeRasterCacheToken;
}

async function buildShapeRasterCache(token, buildPlan) {
    if (token !== shapeRasterCacheToken || !shouldPrepareShapeRasterCache()) return null;

    const bounds = buildPlan?.bounds || getShapeRasterCacheBounds();
    if (!bounds) return null;

    const rasterScale = buildPlan?.rasterScale || getShapeRasterScaleForBounds(bounds, getShapeRasterCacheTargetScale());
    const shapesForRaster = allShapesSorted || [];
    const rasterWidth = Math.max(1, Math.floor(bounds.width * rasterScale));
    const rasterHeight = Math.max(1, Math.floor(bounds.height * rasterScale));

    const rasterCanvas = document.createElement('canvas');
    rasterCanvas.width = rasterWidth;
    rasterCanvas.height = rasterHeight;
    const rasterCtx = rasterCanvas.getContext('2d', { alpha: false, desynchronized: true }) || rasterCanvas.getContext('2d');
    if (!rasterCtx) return null;

    rasterCtx.fillStyle = '#fff';
    rasterCtx.fillRect(0, 0, rasterWidth, rasterHeight);

    rasterCtx.save();
    rasterCtx.scale(rasterScale, rasterScale);
    rasterCtx.translate(-bounds.minX, -bounds.minY);

    const rendered = await renderShapesToContextBatched(rasterCtx, shapesForRaster, {
        token,
        yieldEvery: SHAPE_RASTER_BUILD_YIELD_EVERY
    });

    if (!rendered) {
        rasterCtx.restore();
        return null;
    }

    rasterCtx.restore();

    if (token !== shapeRasterCacheToken) return null;

    if (svgData && typeof drawSvgLayersToRasterContext === 'function') {
        await drawSvgLayersToRasterContext(rasterCtx, {
            svgSource: svgData,
            bounds,
            scale: rasterScale,
            includeText: layerVisibility?.['svg_text'] !== false,
            includeGraphic: layerVisibility?.['svg_graphic'] !== false
        });
    }

    if (token !== shapeRasterCacheToken) return null;

    return {
        canvas: rasterCanvas,
        bounds,
        scale: rasterScale,
        kind: 'json'
    };
}

function scheduleShapeRasterCacheBuild() {
    if (!shouldPrepareShapeRasterCache()) {
        shapeRasterCache = null;
        shapeRasterCacheBuildPromise = null;
        shapeRasterPreviewMountedCanvas = null;
        hideShapeRasterPreview();
        return;
    }
    if (shapeRasterCacheBuildScheduled || shapeRasterCacheBuildPromise) return;

    const token = shapeRasterCacheToken;
    shapeRasterCacheBuildScheduled = true;
    requestAnimationFrame(() => {
        shapeRasterCacheBuildScheduled = false;
        shapeRasterCacheBuildPromise = (async () => {
            while (token === shapeRasterCacheToken && shouldPrepareShapeRasterCache()) {
                const buildPlan = getNextShapeRasterBuildPlan();
                if (!buildPlan) {
                    return;
                }

                const nextPreview = await buildShapeRasterCache(token, buildPlan);
                if (!nextPreview || token !== shapeRasterCacheToken) {
                    return;
                }

                shapeRasterCache = nextPreview;
                shapeRasterPreviewMountedCanvas = null;
                scheduleDraw();
                return;
            }
        })()
            .catch(error => {
                console.warn('Shape raster cache build failed:', error);
            })
            .finally(() => {
                shapeRasterCacheBuildPromise = null;
                if (shouldPrepareShapeRasterCache() && getNextShapeRasterBuildPlan()) {
                    scheduleShapeRasterCacheBuild();
                }
            });
    });
}

async function ensureShapeRasterCache(minScale = getShapeRasterCacheTargetScale()) {
    if (!shouldPrepareShapeRasterCache()) return null;
    while (true) {
        scheduleShapeRasterCacheBuild();
        if (shapeRasterCacheBuildPromise) {
            await shapeRasterCacheBuildPromise;
        }
        if (!shapeRasterCache) return null;
        if (!Number.isFinite(minScale) || shapeRasterCache.scale + SHAPE_RASTER_SCALE_EPSILON >= minScale) {
            return shapeRasterCache;
        }
        if (!getNextShapeRasterBuildPlan()) {
            return shapeRasterCache;
        }
    }
}

function redrawCropPreview(previewCtx, croppedObjs, bboxRef, cropCanvas) {
    const scaleX = cropCanvas.width / bboxRef.width;
    const scaleY = cropCanvas.height / bboxRef.height;
    const scale = Math.min(scaleX, scaleY);
    const offsetX2 = (cropCanvas.width - bboxRef.width * scale) / 2;
    const offsetY2 = (cropCanvas.height - bboxRef.height * scale) / 2;
    previewCtx.save();
    previewCtx.translate(offsetX2, offsetY2);
    previewCtx.scale(scale, scale);
    previewCtx.translate(-bboxRef.x, -bboxRef.y);
    croppedObjs.forEach(({ obj }) => {
        if (obj.type === 'text' || !obj.items) return;
        obj.items.forEach((item, itemIndex) => {
            const type = item[0];
            if (!(type === 'l' || type === 'c' || type === 'qu')) return;
            const found = cropItems.find(ci => ci.obj === obj && ci.itemIndex === itemIndex);
            if (!found) return;
            const selected = cropSelectedItemIds.has(found.id);
            previewCtx.strokeStyle = selected ? toRgbString(obj.color || [0, 0, 0]) : toRgbString(obj.color || [0, 0, 0], 0.02);
            previewCtx.lineWidth = getEffectiveWidth(obj.width);
            previewCtx.beginPath();
            if (type === 'l') {
                previewCtx.moveTo(item[1][0], item[1][1]);
                previewCtx.lineTo(item[2][0], item[2][1]);
            } else if (type === 'c') {
                previewCtx.moveTo(item[1][0], item[1][1]);
                previewCtx.bezierCurveTo(item[2][0], item[2][1], item[3][0], item[3][1], item[4][0], item[4][1]);
            } else if (type === 'qu') {
                const pts = item[1];
                if (pts?.length === 4) {
                    previewCtx.moveTo(pts[0][0], pts[0][1]);
                    previewCtx.lineTo(pts[1][0], pts[1][1]);
                    previewCtx.lineTo(pts[3][0], pts[3][1]);
                    previewCtx.lineTo(pts[2][0], pts[2][1]);
                    previewCtx.closePath();
                }
            }
            previewCtx.stroke();
        });
    });
    previewCtx.restore();
}
function applySvgTransform() {
    if (!svgData) return;
    
    const textLayer = document.getElementById('svg-text-layer');
    const graphicLayer = document.getElementById('svg-graphic-layer');
    
    // Always update display state - even if both layers are hidden
    const allowVectorLayers = zoom > getLowZoomRasterThreshold();
    const textVisible = allowVectorLayers && layerVisibility['svg_text'];
    const graphicVisible = allowVectorLayers && layerVisibility['svg_graphic'];
    
    // If both layers are hidden, hide the container layers and return early
    if (!textVisible && !graphicVisible) {
        textLayer.style.display = 'none';
        graphicLayer.style.display = 'none';
        return;
    }
    
    const viewMinX = -offsetX / zoom;
    const viewMinY = -offsetY / zoom;
    const viewWidth = canvas.width / zoom;
    const viewHeight = canvas.height / zoom;
    const svgTextEl = textLayer.querySelector('svg');
    const svgGraphicEl = graphicLayer.querySelector('svg');
    if (svgTextEl) {
        svgTextEl.setAttribute('viewBox', `${viewMinX} ${viewMinY} ${viewWidth} ${viewHeight}`);
        svgTextEl.style.width = canvas.width + 'px';
        svgTextEl.style.height = canvas.height + 'px';
    }
    if (svgGraphicEl) {
        svgGraphicEl.setAttribute('viewBox', `${viewMinX} ${viewMinY} ${viewWidth} ${viewHeight}`);
        svgGraphicEl.style.width = canvas.width + 'px';
        svgGraphicEl.style.height = canvas.height + 'px';
    }
    textLayer.style.display = textVisible ? 'block' : 'none';
    graphicLayer.style.display = graphicVisible ? 'block' : 'none';
}

function drawViewportOverlays(targetCtx, allowVectorHighlights = zoom > getLowZoomRasterThreshold()) {
    if (currentBbox && currentBbox.width > 0 && currentBbox.height > 0) {
        targetCtx.strokeStyle = 'red';
        targetCtx.lineWidth = 2 / zoom;
        targetCtx.strokeRect(currentBbox.x, currentBbox.y, currentBbox.width, currentBbox.height);
    }

    if (anchorBbox && !isApplyingSavedPattern) {
        targetCtx.strokeStyle = 'blue';
        targetCtx.lineWidth = 2 / zoom;
        targetCtx.strokeRect(anchorBbox.x, anchorBbox.y, anchorBbox.width, anchorBbox.height);
    }

    similarBboxes.forEach(rect => {
        targetCtx.strokeStyle = 'green';
        targetCtx.lineWidth = CONFIG.SIMILAR_BBOX_LINE_WIDTH / zoom;
        targetCtx.strokeRect(rect.x, rect.y, rect.width, rect.height);
        targetCtx.fillStyle = 'green';
        targetCtx.font = `${12 / zoom}px Arial`;
        targetCtx.fillText(`${(rect.score * 100).toFixed(0)}%`, rect.x, rect.y - 5 / zoom);
    });

    if (sequenceMatches?.length) {
        sequenceMatches.forEach(m => {
            if (CONFIG.MERGE_RESULTS) {
                targetCtx.strokeStyle = 'green';
                targetCtx.setLineDash([]);
                targetCtx.fillStyle = 'green';
            } else {
                targetCtx.strokeStyle = 'purple';
                targetCtx.setLineDash([3, 3]);
                targetCtx.fillStyle = 'purple';
            }
            targetCtx.lineWidth = CONFIG.SIMILAR_BBOX_LINE_WIDTH / zoom;
            targetCtx.strokeRect(m.rect.x, m.rect.y, m.rect.width, m.rect.height);
            if (!CONFIG.MERGE_RESULTS) targetCtx.setLineDash([]);
            targetCtx.font = `${12 / zoom}px Arial`;
            targetCtx.fillText(`${(m.score * 100).toFixed(0)}%`, m.rect.x, m.rect.y - 5 / zoom);
        });
    }

    if (allowVectorHighlights && hoveredGroup !== null) {
        const seqnos = groupToSeqnos[hoveredGroup];
        const highlightedShapes = new Set();
        if (seqnos) {
            seqnos.forEach(seqno => {
                const ids = globalSeqnoToIds[seqno];
                if (ids) {
                    ids.forEach(id => {
                        const [objIndex] = id.split('-').map(Number);
                        highlightedShapes.add(objIndex);
                    });
                }
            });
        }
        highlightedShapes.forEach(objIndex => {
            const obj = jsonShapes[objIndex];
            let layerKey = obj[currentLayerField];
            if (currentLayerField === 'layer' && (!layerKey || layerKey.trim() === '')) {
                layerKey = '__default_shape_layer__';
            }
            if (obj.type === 'text' || !layerVisibility[layerKey]) return;
            drawShapeOnCtxWithColor(targetCtx, obj, [255, 0, 0]);
        });
    }

    if (typeof drawManualAnnotationOverlays === 'function') {
        drawManualAnnotationOverlays(targetCtx);
    }
}

function draw() {
    const preferShapeRasterPreview = shouldPreferShapeRasterPreview();
    const activeRasterPreviewSource = preferShapeRasterPreview ? getActiveRasterPreviewSource() : null;
    if (preferShapeRasterPreview && !getActiveRasterPreviewSource()) {
        scheduleActiveRasterPreviewBuild();
    }
    updateZoomIndicator(preferShapeRasterPreview);
    updateRenderSurfaceMode(preferShapeRasterPreview);

    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!jsonShapes || !jsonShapes.length) {
        if (preferShapeRasterPreview && activeRasterPreviewSource) {
            ctx.translate(offsetX, offsetY);
            ctx.scale(zoom, zoom);
            drawRasterPreviewOnCtx(ctx, activeRasterPreviewSource);
            drawViewportOverlays(ctx, false);
        } else if (svgData && !preferShapeRasterPreview) {
            ctx.translate(offsetX, offsetY);
            ctx.scale(zoom, zoom);
        }
        ctx.restore();
        applySvgTransform();
        // Draw crosshair overlay even when no shapes
        drawCrosshairOverlay();
        return;
    }

    ctx.translate(offsetX, offsetY);
    ctx.scale(zoom, zoom);

    if (preferShapeRasterPreview) {
        drawRasterPreviewOnCtx(ctx, activeRasterPreviewSource);
        drawViewportOverlays(ctx, false);
        ctx.restore();
        applySvgTransform();
        drawCrosshairOverlay();
        return;
    }

    // ============================================
    // PERFORMANCE OPTIMIZATION: Use Quadtree for visible shapes
    // ============================================
    const viewMinX = -offsetX / zoom;
    const viewMinY = -offsetY / zoom;
    const viewMaxX = (canvas.width - offsetX) / zoom;
    const viewMaxY = (canvas.height - offsetY) / zoom;

    // Add padding to viewport to prevent shapes "popping" at edges
    const viewportPadding = 50 / zoom;
    const shapesToRender = getVisibleShapesForView(
        viewMinX,
        viewMinY,
        viewMaxX,
        viewMaxY,
        viewportPadding
    );

    const useCropFilter = Boolean(cropLengths);
    const useShapeRasterPreview = Boolean(preferShapeRasterPreview && shapeRasterCache);
    const useShapeRasterCache = Boolean(
        shapeRasterCache &&
        (
            useShapeRasterPreview ||
            (
                isInteracting &&
                !isDrawingBbox &&
                !isVLMBboxMode &&
                !annotationMode &&
                !useCropFilter &&
                !mainLayers
            )
        )
    );

    let currentStrokeStyle = null;
    let currentLineWidth = null;
    let strokePending = false;
    
    let currentFillStyle = null;
    let fillPending = false;

    function flushFills() {
        if (fillPending) {
            ctx.fillStyle = currentFillStyle;
            ctx.fill();
            fillPending = false;
        }
    }
    function flushStrokes() {
        if (strokePending) {
            ctx.strokeStyle = currentStrokeStyle;
            ctx.lineWidth = currentLineWidth;
            ctx.stroke();
            strokePending = false;
        }
    }

    // ============================================
    // UNIFIED RENDER LOOP: Both pipeline and shape layers use same logic
    // ============================================
    if (useShapeRasterCache) {
        drawShapeRasterCache(ctx);
    } else {
        shapesToRender.forEach(obj => {
            const layerName = obj.layer;
            if (!layerVisibility[layerName]) return;

            if (obj.bbox) {
                const padding = (obj.width || 2);
                if (obj.bbox.maxX + padding < viewMinX ||
                    obj.bbox.minX - padding > viewMaxX ||
                    obj.bbox.maxY + padding < viewMinY ||
                    obj.bbox.minY - padding > viewMaxY) {
                    return;
                }
            }

            if (useCropFilter && mainLayers && !mainLayers.includes(layerName) && !isApplyingSavedPattern && !obj._isPipelineLayer) return;

            if (isInteracting && !isDrawingBbox) {
                if (obj.fill) {
                    const fillStyle = obj._fillStyle || toRgbString(obj.fill);
                    if (currentFillStyle !== fillStyle || strokePending) {
                        flushFills();
                        flushStrokes();
                        currentFillStyle = fillStyle;
                        ctx.beginPath();
                    }
                    addShapeToPath(ctx, obj);
                    fillPending = true;
                }
                if (obj.color && obj.items) {
                    const styleKey = obj._strokeStyle || toRgbString(obj.color);
                    const widthKey = obj._effectiveWidth || getEffectiveWidth(obj.width);
                    if (currentStrokeStyle !== styleKey || currentLineWidth !== widthKey || fillPending) {
                        flushFills();
                        flushStrokes();
                        currentStrokeStyle = styleKey;
                        currentLineWidth = widthKey;
                        ctx.beginPath();
                    }
                    obj.items?.forEach(item => {
                        const type = item[0];
                        if (type === 'l') {
                            ctx.moveTo(item[1][0], item[1][1]);
                            ctx.lineTo(item[2][0], item[2][1]);
                        } else if (type === 'c') {
                            ctx.moveTo(item[1][0], item[1][1]);
                            ctx.bezierCurveTo(item[2][0], item[2][1], item[3][0], item[3][1], item[4][0], item[4][1]);
                        } else if (type === 'qu') {
                            const points = item[1];
                            if (points?.length === 4) {
                                ctx.moveTo(points[0][0], points[0][1]);
                                ctx.lineTo(points[1][0], points[1][1]);
                                ctx.lineTo(points[3][0], points[3][1]);
                                ctx.lineTo(points[2][0], points[2][1]);
                                ctx.closePath();
                            }
                        } else if (type === 'poly') {
                            const points = item[1];
                            if (points?.length > 0) {
                                ctx.moveTo(points[0][0], points[0][1]);
                                for (let i = 1; i < points.length; i++) {
                                    ctx.lineTo(points[i][0], points[i][1]);
                                }
                                ctx.closePath();
                            }
                        }
                    });
                    strokePending = true;
                }
            } else if (cropLengths && mainLayers) {
                flushFills();
                flushStrokes();
                drawShapeOnCtx(ctx, obj);
            } else {
                const filteredItems = useCropFilter ? (obj.items?.filter((item, itemIndex) => {
                    const type = item[0];
                    if (!cropLengths[type] || cropLengths[type].length === 0) return true;
                    const currentLength = getOrComputeLength(layerName, obj.id, itemIndex, type, item);
                    return cropLengths[type].some(len => Math.abs(len - currentLength) <= 1);
                }) || []) : (obj.items || []);

                if (filteredItems.length === 0) return;

                if (obj.fill) {
                    const styleKey = obj._fillStyle || toRgbString(obj.fill);
                    if (currentFillStyle !== styleKey || strokePending) {
                        flushFills();
                        flushStrokes();
                        currentFillStyle = styleKey;
                        ctx.beginPath();
                    }

                    let started = false, cx, cy;
                    filteredItems.forEach(item => {
                        const type = item[0];
                        if (type === 'l') {
                            const [sx, sy] = item[1], [ex, ey] = item[2];
                            if (!started) { ctx.moveTo(sx, sy); started = true; }
                            else if (cx !== sx || cy !== sy) ctx.moveTo(sx, sy);
                            ctx.lineTo(ex, ey);
                            cx = ex; cy = ey;
                        } else if (type === 'c') {
                            const [p0x, p0y] = item[1], [p1x, p1y] = item[2], [p2x, p2y] = item[3], [p3x, p3y] = item[4];
                            if (!started) { ctx.moveTo(p0x, p0y); started = true; }
                            else if (cx !== p0x || cy !== p0y) ctx.moveTo(p0x, p0y);
                            ctx.bezierCurveTo(p1x, p1y, p2x, p2y, p3x, p3y);
                            cx = p3x; cy = p3y;
                        } else if (type === 'qu') {
                            const points = item[1];
                            if (points?.length === 4) {
                                const [q0x, q0y] = points[0];
                                if (!started) { ctx.moveTo(q0x, q0y); started = true; }
                                else if (cx !== q0x || cy !== q0y) ctx.moveTo(q0x, q0y);
                                ctx.lineTo(points[1][0], points[1][1]);
                                ctx.lineTo(points[3][0], points[3][1]);
                                ctx.lineTo(points[2][0], points[2][1]);
                                ctx.closePath();
                                cx = q0x; cy = q0y;
                            }
                        } else if (type === 'poly') {
                            const points = item[1];
                            if (points?.length > 0) {
                                const [q0x, q0y] = points[0];
                                if (!started) { ctx.moveTo(q0x, q0y); started = true; }
                                else if (cx !== q0x || cy !== q0y) ctx.moveTo(q0x, q0y);
                                for (let i = 1; i < points.length; i++) {
                                    ctx.lineTo(points[i][0], points[i][1]);
                                }
                                ctx.closePath();
                                cx = q0x; cy = q0y;
                            }
                        }
                    });
                    if (obj.closePath) ctx.closePath();
                    fillPending = true;
                }

                if (obj.color && obj.items) {
                    const styleKey = obj._strokeStyle || toRgbString(obj.color);
                    const widthKey = obj._effectiveWidth || getEffectiveWidth(obj.width);
                    if (currentStrokeStyle !== styleKey || currentLineWidth !== widthKey || fillPending) {
                        flushFills();
                        flushStrokes();
                        currentStrokeStyle = styleKey;
                        currentLineWidth = widthKey;
                        ctx.beginPath();
                    }

                    filteredItems.forEach(item => {
                        const type = item[0];
                        if (type === 'l') {
                            ctx.moveTo(item[1][0], item[1][1]);
                            ctx.lineTo(item[2][0], item[2][1]);
                        } else if (type === 'c') {
                            ctx.moveTo(item[1][0], item[1][1]);
                            ctx.bezierCurveTo(item[2][0], item[2][1], item[3][0], item[3][1], item[4][0], item[4][1]);
                        } else if (type === 'qu') {
                            const points = item[1];
                            if (points?.length === 4) {
                                ctx.moveTo(points[0][0], points[0][1]);
                                ctx.lineTo(points[1][0], points[1][1]);
                                ctx.lineTo(points[3][0], points[3][1]);
                                ctx.lineTo(points[2][0], points[2][1]);
                                ctx.closePath();
                            }
                        } else if (type === 'poly') {
                            const points = item[1];
                            if (points?.length > 0) {
                                ctx.moveTo(points[0][0], points[0][1]);
                                for (let i = 1; i < points.length; i++) {
                                    ctx.lineTo(points[i][0], points[i][1]);
                                }
                                ctx.closePath();
                            }
                        }
                    });
                    strokePending = true;
                }
            }
        });
    }
        
    // Flush any remaining batched draws
    flushFills();
    flushStrokes();

    drawViewportOverlays(ctx, true);
    ctx.restore();
    applySvgTransform();
    
    // Draw crosshair on overlay canvas (always on top)
    drawCrosshairOverlay();
}

// Crosshair overlay function - draws on separate canvas above everything
function drawCrosshairOverlay() {
    if (typeof drawManualLabelCrosshairOverlay === 'function' && annotationMode) {
        crosshairCanvas.style.display = 'block';
        crosshairOverlayVisible = true;
        crosshairCtx.clearRect(0, 0, crosshairCanvas.width, crosshairCanvas.height);
        drawManualLabelCrosshairOverlay();
        return;
    }
    
    // Only draw crosshair when in draw mode
    if (!isDrawingBbox && !isVLMBboxMode) {
        if (crosshairOverlayVisible) {
            crosshairCtx.clearRect(0, 0, crosshairCanvas.width, crosshairCanvas.height);
            crosshairOverlayVisible = false;
        }
        crosshairCanvas.style.display = 'none';
        return;
    }

    crosshairCanvas.style.display = 'block';
    crosshairOverlayVisible = true;
    crosshairCtx.clearRect(0, 0, crosshairCanvas.width, crosshairCanvas.height);
    
    crosshairCtx.strokeStyle = 'black';
    crosshairCtx.lineWidth = 0.5;
    crosshairCtx.setLineDash([]);
    
    // Calculate screen coordinates
    const screenX = mouseX * zoom + offsetX;
    const screenY = mouseY * zoom + offsetY;
    
    // Draw crosshair lines
    crosshairCtx.beginPath();
    crosshairCtx.moveTo(0, screenY);
    crosshairCtx.lineTo(crosshairCanvas.width, screenY);
    crosshairCtx.stroke();
    
    crosshairCtx.beginPath();
    crosshairCtx.moveTo(screenX, 0);
    crosshairCtx.lineTo(screenX, crosshairCanvas.height);
    crosshairCtx.stroke();
    
    // Draw VLM bbox rectangle if exists (dashed green rectangle on overlay)
    if (isVLMBboxMode && vlmBboxStart && vlmBboxEnd) {
        const vlmBbox = {
            x: Math.min(vlmBboxStart.x, vlmBboxEnd.x),
            y: Math.min(vlmBboxStart.y, vlmBboxEnd.y),
            width: Math.abs(vlmBboxEnd.x - vlmBboxStart.x),
            height: Math.abs(vlmBboxEnd.y - vlmBboxStart.y)
        };
        if (vlmBbox.width > 0 && vlmBbox.height > 0) {
            const screenBbox = {
                x: vlmBbox.x * zoom + offsetX,
                y: vlmBbox.y * zoom + offsetY,
                width: vlmBbox.width * zoom,
                height: vlmBbox.height * zoom
            };
            crosshairCtx.strokeStyle = '#28a745';
            crosshairCtx.lineWidth = 2;
            crosshairCtx.setLineDash([5, 5]);
            crosshairCtx.strokeRect(screenBbox.x, screenBbox.y, screenBbox.width, screenBbox.height);
            crosshairCtx.setLineDash([]);
        }
    }
}

function scheduleDraw() {
    if (drawScheduled) return;
    drawScheduled = true;
    requestAnimationFrame(() => {
        draw();
        drawScheduled = false;
    });
}