import { createWorker } from 'agglomerative-clustering/worker';
declare const imageData: ImageData;
async function main() {
    await using worker = createWorker();
    await using handle = await worker.cluster(imageData);
    await handle.getPalette(4);
}
void main;
