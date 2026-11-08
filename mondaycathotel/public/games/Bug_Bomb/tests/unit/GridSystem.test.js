import { describe, it, expect } from 'vitest';
import { GridSystem } from '../../src/engine/physics/GridSystem.js';

describe('GridSystem', () => {
    it('should initialize with correct rows and cols', () => {
        const grid = new GridSystem(13, 11);
        expect(grid.cols).toBe(13);
        expect(grid.rows).toBe(11);
    });

    it('should calculate pixel coordinates correctly', () => {
        const grid = new GridSystem(13, 11);
        grid.updateCellSize(1300, 1100);
        
        const pos = grid.getPixelCoord(1, 1);
        expect(pos.x).toBe(100);
        expect(pos.y).toBe(100);
    });
});
