// quadtree.js
// ============================================
// PERFORMANCE OPTIMIZATION: Quadtree Spatial Index
// ============================================
class Quadtree {
    constructor(bounds, capacity = 25, maxDepth = 10) {
        this.bounds = bounds; // {x, y, width, height}
        this.capacity = capacity;
        this.maxDepth = maxDepth;
        this.objects = [];
        this.divided = false;
        this.children = null; // nw, ne, sw, se
    }

    subdivide() {
        const { x, y, width, height } = this.bounds;
        const hw = width / 2;
        const hh = height / 2;

        this.children = {
            nw: new Quadtree({ x: x, y: y, width: hw, height: hh }, this.capacity, this.maxDepth - 1),
            ne: new Quadtree({ x: x + hw, y: y, width: hw, height: hh }, this.capacity, this.maxDepth - 1),
            sw: new Quadtree({ x: x, y: y + hh, width: hw, height: hh }, this.capacity, this.maxDepth - 1),
            se: new Quadtree({ x: x + hw, y: y + hh, width: hw, height: hh }, this.capacity, this.maxDepth - 1)
        };
        this.divided = true;
    }

    insert(obj) {
        if (!obj?.bbox || !this.intersects(obj.bbox)) return false;

        if (this.divided) {
            const child = this.getContainingChild(obj.bbox);
            if (child) return child.insert(obj);
        }

        if (this.objects.length < this.capacity || this.maxDepth <= 0) {
            this.objects.push(obj);
            return true;
        }

        if (!this.divided) {
            this.subdivide();
            this.redistributeObjects();
        }

        const child = this.getContainingChild(obj.bbox);
        if (child) return child.insert(obj);

        this.objects.push(obj);
        return true;
    }

    getContainingChild(bbox) {
        if (!this.divided) return null;
        if (this.fullyContains(this.children.nw.bounds, bbox)) return this.children.nw;
        if (this.fullyContains(this.children.ne.bounds, bbox)) return this.children.ne;
        if (this.fullyContains(this.children.sw.bounds, bbox)) return this.children.sw;
        if (this.fullyContains(this.children.se.bounds, bbox)) return this.children.se;
        return null;
    }

    fullyContains(bounds, bbox) {
        return !(
            bbox.minX < bounds.x ||
            bbox.maxX > bounds.x + bounds.width ||
            bbox.minY < bounds.y ||
            bbox.maxY > bounds.y + bounds.height
        );
    }

    redistributeObjects() {
        if (!this.divided || this.objects.length === 0) return;

        const remainingObjects = [];
        for (const obj of this.objects) {
            const child = this.getContainingChild(obj.bbox);
            if (child) child.insert(obj);
            else remainingObjects.push(obj);
        }
        this.objects = remainingObjects;
    }

    contains(bbox) {
        return !(
            bbox.maxX < this.bounds.x ||
            bbox.minX > this.bounds.x + this.bounds.width ||
            bbox.maxY < this.bounds.y ||
            bbox.minY > this.bounds.y + this.bounds.height
        );
    }

    intersects(range) {
        return !(
            range.maxX < this.bounds.x ||
            range.minX > this.bounds.x + this.bounds.width ||
            range.maxY < this.bounds.y ||
            range.minY > this.bounds.y + this.bounds.height
        );
    }

    query(range, result = []) {
        if (!this.intersects(range)) return result;

        for (const obj of this.objects) {
            if (this.objectIntersects(obj.bbox, range)) {
                result.push(obj);
            }
        }

        if (this.divided) {
            this.children.nw.query(range, result);
            this.children.ne.query(range, result);
            this.children.sw.query(range, result);
            this.children.se.query(range, result);
        }

        return result;
    }

    objectIntersects(objBbox, range) {
        return !(
            objBbox.maxX < range.minX ||
            objBbox.minX > range.maxX ||
            objBbox.maxY < range.minY ||
            objBbox.minY > range.maxY
        );
    }
}

// Quadtree instance
let shapeQuadtree = null;