const STORE_EXT = /\.(mp4|webm|ogg|m4v|mov|png|jpe?g|gif|webp|avif|woff2?|zip|gz|pdf)$/i;

export function usesStoredCompression(relativePath) {
  return STORE_EXT.test(relativePath);
}

export function portableBackupPlan(inventory, loaderLimitBytes) {
  const storedLowerBoundBytes = inventory.reduce((total, item) => (
    total + (usesStoredCompression(item.relative) ? item.size : 0)
  ), 0);
  return { skip: storedLowerBoundBytes > loaderLimitBytes, storedLowerBoundBytes };
}
