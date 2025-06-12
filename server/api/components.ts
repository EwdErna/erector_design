// find all components in the assets/components directory and return their names with category
// folder structure:
// assets
// └── components
//     ├── category1
//     │   ├── component1.gltf
//     │   └── component2.gltf
//     └── category2

import { resolve } from 'path';
import { readdir } from 'fs/promises';
export default defineEventHandler(async (event) => {
  const componentsDir = 'assets/components';
  const categories = await readdir(componentsDir, { withFileTypes: true });

  const components = await Promise.all(
    categories.map(async (category) => {
      if (category.isDirectory()) {
        const categoryPath = resolve(componentsDir, category.name);
        const files = await readdir(categoryPath);
        return {
          category: category.name,
          components: files.filter(file => file.endsWith('.gltf')),
        };
      }
      return null;
    })
  );

  return components.filter(v => v !== null);
})
