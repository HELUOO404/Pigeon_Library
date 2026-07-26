// course-overrides.js - Merge server-managed metadata into bundled course defaults.

export function firstCodePoint(value = '') {
  return Array.from(String(value))[0] || '';
}

export function resolveCourseCover({ title = '', baseImage = '', baseText = '', mode = 'default', image = '', text = '' }) {
  if (mode === 'image' && image) return { coverUrl: image, coverText: '' };
  if (mode === 'text' && text) return { coverUrl: '', coverText: text };
  return { coverUrl: baseImage, coverText: baseText || (baseImage ? '' : firstCodePoint(title)) };
}

export function applyBuiltinOverrides(defaults, overrides, { includeInvisible = false } = {}) {
  const byKey = new Map((overrides || []).map((item) => [item.course_key, item]));
  return (defaults || []).flatMap((course) => {
    const override = byKey.get(course.id);
    if (override?.hidden === 1) return [];
    if (!includeInvisible && override?.visible === 0) return [];
    const coverMode = override?.cover_mode || 'default';
    const coverImageOverride = override?.cover_data || override?.cover_image || '';
    const coverTextOverride = override?.cover_text || '';
    const baseCoverUrl = course.coverUrl || '';
    const baseCoverText = course.coverText || '';
    const resolved = resolveCourseCover({
      title: override?.title ?? course.title,
      baseImage: baseCoverUrl,
      baseText: baseCoverText,
      mode: coverMode,
      image: coverImageOverride,
      text: coverTextOverride,
    });
    return [{
      ...course,
      title: override?.title ?? course.title,
      subtitle: override ? (override.subtitle || '') : (course.subtitle || ''),
      description: override ? (override.description || '') : (course.description || ''),
      author: override ? (override.author || '') : (course.author || ''),
      publisherName: override?.publisher_name ?? course.author ?? 'PigeonLib',
      category: override?.category || '',
      updatedAt: override?.updated_at || 0,
      visible: override?.visible !== 0,
      coverMode,
      coverImageOverride,
      coverTextOverride,
      baseCoverUrl,
      baseCoverText,
      coverUrl: resolved.coverUrl,
      coverText: resolved.coverText,
    }];
  });
}
