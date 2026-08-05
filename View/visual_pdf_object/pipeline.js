// pipeline.js

// Convert pipeline result objects to drawable shapes (inspired by Agent.html)
function convertPipelineToShapes(pipelineObjects) {
    const shapes = [];
    const pipeColorMap = {};

    // Assign colors to pipe_ids
    pipelineObjects.forEach(obj => {
        if (obj.pipe_id !== undefined && !pipeColorMap[obj.pipe_id]) {
            const colorIdx = Object.keys(pipeColorMap).length % KELLY_COLORS.length;
            const hexColor = KELLY_COLORS[colorIdx];
            // Convert hex to RGB 0-1 format
            const r = parseInt(hexColor.slice(1, 3), 16) / 255;
            const g = parseInt(hexColor.slice(3, 5), 16) / 255;
            const b = parseInt(hexColor.slice(5, 7), 16) / 255;
            pipeColorMap[obj.pipe_id] = [r, g, b];
        }
    });

    pipelineObjects.forEach((obj, idx) => {
        if (!obj.vertices || obj.vertices.length === 0) return;

        const pipeColor = pipeColorMap[obj.pipe_id] || [0.5, 0.5, 0.5];
        const shapeName = obj.shape_name || 'Unknown';
        let items = [];
        let fill = null;
        let color = pipeColor;
        let width = 3; // Increased default width

        // Use shape-specific color if defined
        if (PIPELINE_SHAPE_COLORS[shapeName]) {
            color = PIPELINE_SHAPE_COLORS[shapeName];
        }

        // Convert based on shape type (matching Agent.html visualization style)
        if (shapeName === 'Line') {
            // Line: draw as line segment or polygon based on vertices count
            if (obj.vertices.length === 2) {
                items = [['l', obj.vertices[0], obj.vertices[1]]];
            } else if (obj.vertices.length >= 4) {
                // Line as polygon (rectangle or polyline shape)
                items = [['poly', obj.vertices]];
                fill = [...pipeColor, 0.3]; // Semi-transparent fill
            } else {
                // Fallback for other cases
                items = [['poly', obj.vertices]];
                fill = [...pipeColor, 0.3];
            }
            width = 4; // Thicker lines for better visibility

        } else if (shapeName === 'Sprinkler') {
            // Sprinkler: use type-specific colors (high contrast)
            if (obj.type === 'end') {
                color = [0.0, 0.5, 1.0]; // Bright red
                fill = [...color, 0.8];
            } else if (obj.type === 'center') {
                color = [0.0, 1.0, 0.0]; // Bright green
                fill = [...color, 0.8];
            } else {
                color = [1.0, 0.0, 0.0]; // Bright blue
                fill = [...color, 0.8];
            }

            // Always draw as polygon using exact vertices
            items = [['poly', obj.vertices]];
            width = 3; // Increased width for better visibility

        } else if (shapeName === 'Tee' || shapeName === 'Elbow' ||
            shapeName === 'Cross' || shapeName === 'Reducer') {
            // Junction shapes: draw as filled circles or polygons
            if (obj.vertices.length === 1) {
                const [cx, cy] = obj.vertices[0];
                const radius = 3; // Small radius for junction points
                const points = [];
                const segments = 12; // Sufficient segments for small circle
                for (let i = 0; i < segments; i++) {
                    const angle = (i / segments) * Math.PI * 2;
                    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
                }
                items = [['poly', points]];
                fill = [...color, 0.95]; // Very high opacity for visibility
                width = 2;
            } else {
                // Multiple vertices - draw as polygon with fill
                items = [['poly', obj.vertices]];
                fill = [...color, 0.9];
                width = 3;
            }

        } else if (obj.vertices.length > 1) {
            // Generic polygon for other shape types
            items = [['poly', obj.vertices]];
            fill = [...color, 0.5];
            width = 2;
        }

        if (items.length > 0) {
            // Calculate bounding box
            const xs = obj.vertices.map(v => v[0]);
            const ys = obj.vertices.map(v => v[1]);
            const rect = [
                Math.min(...xs),
                Math.min(...ys),
                Math.max(...xs),
                Math.max(...ys)
            ];

            shapes.push({
                color: color,
                width: width,
                fill: fill,
                rect: rect,
                seqno: obj.id,
                items: items
            });
        }
    });

    return shapes;
}
