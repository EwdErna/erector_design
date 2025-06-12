import { readdir, readFile } from "fs/promises";
import { basename, extname, resolve } from "path";

export default defineEventHandler(async (event): Promise<{ [key: string]: string }> => {
  const { category } = getRouterParams(event);
  const componentsDir = 'server/assets/components';
  // search in assets/components/[category] then return the thumbnails
  try {
    const categoryPath = resolve(componentsDir, category);
    console.log(categoryPath)
    const files = (await readdir(categoryPath)).filter(file => file.endsWith('.png'));
    // Filter for image files and map to their paths
    const thumbnails: { [key: string]: string } = {};
    const imgs = await Promise.all(files.map(file => {
      return readFile(resolve(categoryPath, file), 'base64').then(data => ([basename(file, '.png'), data]));
    }))
    imgs.forEach(([name, data]) => {
      thumbnails[name] = `data:image/png;base64,${data}`;
    });

    return thumbnails;
  } catch (error) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Category not found',
    });
  }
})
