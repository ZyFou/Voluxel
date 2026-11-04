import type { QualityPreset, QualitySettings } from '../core/types';

/**
 * Tuned on a mid-range GPU (Quadro P2200 / GTX 1060 class) at 1080p: `high` holds 60 fps with a
 * few large effects on screen, `ultra` is for screenshots or faster cards.
 */
export const QUALITY_PRESETS: Record<QualityPreset, QualitySettings> = {
	low: {
		renderScale: 0.38, pixelsPerVoxel: 5, stepScale: 1.3, maxSteps: 96, lightSteps: 14, detailShadowSteps: 0,
		detail: 0.75, flowNoise: false, emptySpaceSkipping: true, timeSlicing: true, frustumCulling: true, regionMerging: true, shadows: true,
	},
	medium: {
		renderScale: 0.45, pixelsPerVoxel: 3.5, stepScale: 1.1, maxSteps: 128, lightSteps: 18, detailShadowSteps: 1,
		detail: 1, flowNoise: true, emptySpaceSkipping: true, timeSlicing: true, frustumCulling: true, regionMerging: true, shadows: true,
	},
	high: {
		renderScale: 0.5, pixelsPerVoxel: 2.75, stepScale: 1.0, maxSteps: 160, lightSteps: 24, detailShadowSteps: 1,
		detail: 1, flowNoise: true, emptySpaceSkipping: true, timeSlicing: true, frustumCulling: true, regionMerging: true, shadows: true,
	},
	ultra: {
		renderScale: 0.75, pixelsPerVoxel: 1.75, stepScale: 0.75, maxSteps: 256, lightSteps: 36, detailShadowSteps: 3,
		detail: 1, flowNoise: true, emptySpaceSkipping: true, timeSlicing: false, frustumCulling: true, regionMerging: true, shadows: true,
	},
};

export function resolveQuality( q: QualityPreset | Partial<QualitySettings> | undefined ): QualitySettings {

	if ( ! q ) return { ...QUALITY_PRESETS.high };
	if ( typeof q === 'string' ) return { ...QUALITY_PRESETS[ q ] };
	return { ...QUALITY_PRESETS.high, ...q };

}
