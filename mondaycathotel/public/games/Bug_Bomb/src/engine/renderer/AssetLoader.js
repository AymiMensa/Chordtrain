export class AssetLoader {
    constructor() {
        this.assets = {};
        this.totalAssets = 0;
        this.loadedAssets = 0;
    }

    async loadImages(imageSources) {
        this.totalAssets = Object.keys(imageSources).length;
        this.loadedAssets = 0;
        const promises = [];

        for (const [key, src] of Object.entries(imageSources)) {
            const promise = new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d', { willReadFrequently: true });
                    ctx.drawImage(img, 0, 0);
                    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    const data = imgData.data;
                    
                    const bgR = data[0], bgG = data[1], bgB = data[2];
                    const isWhiteBg = bgR > 200 && bgG > 200 && bgB > 200;
                    const tolerance = 40;
                    
                    for (let i = 0; i < data.length; i += 4) {
                        const r = data[i], g = data[i+1], b = data[i+2];
                        let match = false;
                        if (isWhiteBg) {
                            if (r > 255 - tolerance && g > 255 - tolerance && b > 255 - tolerance) match = true;
                        } else {
                            if (r < tolerance && g < tolerance && b < tolerance) match = true;
                        }
                        if (match) data[i+3] = 0; // Set alpha to 0 (transparent)
                    }
                    ctx.putImageData(imgData, 0, 0);
                    
                    const newImg = new Image();
                    newImg.onload = () => {
                        this.assets[key] = newImg;
                        this.loadedAssets++;
                        resolve();
                    };
                    newImg.src = canvas.toDataURL();
                };
                img.onerror = () => {
                    console.error(`Failed to load image: ${src}`);
                    // Even if it fails, resolve so the game doesn't hang forever, but asset will be missing
                    resolve();
                };
                img.src = src;
            });
            promises.push(promise);
        }

        await Promise.all(promises);
    }

    getImage(key) {
        return this.assets[key];
    }
}

const assetLoader = new AssetLoader();
export default assetLoader;
