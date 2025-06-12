// get component by category and name then return the gltf+bin file as blob

import Path, { basename, resolve } from 'path';
import { readdir, readFile } from 'fs/promises';

export default defineEventHandler(async (event) => {
  const { category, name } = getRouterParams(event)
  const componentsDir = 'server/assets/components'

  try {
    const filePath = resolve(componentsDir, `${category}/${name}.gltf`);
    const binPath = resolve(componentsDir, `${category}/${name}.bin`);
    console.log(filePath)

    // Read the glTF file and bin file as blobs
    const [gltfBlob, binBlob] = await Promise.all([
      readFile(filePath),
      readFile(binPath, 'binary')
    ])
    return {
      gltf: {
        data: gltfBlob.toString('utf-8'),
        mimeType: 'model/gltf+json',
        fileName: `${name}.gltf`,
      },
      bin: {
        data: btoa(binBlob),
        mimeType: 'application/octet-stream',
        fileName: `${name}.bin`,
      },
    };
  } catch (error) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Component not found',
    });
  }
})
