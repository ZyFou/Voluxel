import type {
	BehaviorDefinition, EffectDefinition, EmitterDefinition, LookDefinition, SpawnOptions, Vec3Tuple,
} from '../core/types';
import { Rng, clamp, smoothstep, turbulence } from '../core/math';

export interface SimContext {
	wind: Vec3Tuple;
	groundHeight: number;
}

interface EmitterState {
	def: EmitterDefinition;
	group: number;
	sourceGroup: number;
	accumulator: number;
	fired: boolean;
}

interface GroupStats {
	cx: number; cy: number; cz: number;
	/** RMS horizontal radius */
	hr: number;
	/** min / max Y of members */
	minY: number; maxY: number;
	w: number;
}

const _turb = new Float32Array( 3 );
const _dir = new Float32Array( 3 );

/**
 * One running instance of an {@link EffectDefinition}: a CPU billow simulation.
 *
 * Billows are stored structure-of-arrays. Children (sub-billows that give the cauliflower
 * look) are rigidly attached to their parent and are re-positioned after the parent moves.
 */
export class VoluxelEffect {

	private static nextId = 1;

	readonly id = VoluxelEffect.nextId ++;
	readonly definition: EffectDefinition;
	readonly origin: Vec3Tuple;
	readonly scale: number;
	readonly rotation: number;
	readonly seed: number;
	look: LookDefinition;

	time = 0;
	finished = false;
	/** Region slot this effect was voxelised into last frame (-1 = none). */
	regionSlot = - 1;
	/** Set by the world when the user removes the effect. */
	killed = false;

	readonly capacity: number;
	count = 0;

	// --- billow state (SoA) ---
	readonly px: Float32Array; readonly py: Float32Array; readonly pz: Float32Array;
	readonly vx: Float32Array; readonly vy: Float32Array; readonly vz: Float32Array;
	readonly r: Float32Array; readonly r0: Float32Array; readonly rMax: Float32Array;
	readonly growth: Float32Array; readonly growthDecay: Float32Array;
	readonly dens: Float32Array; readonly dens0: Float32Array;
	readonly temp: Float32Array; readonly temp0: Float32Array; readonly cooling: Float32Array;
	readonly soot: Float32Array;
	readonly age: Float32Array; readonly life: Float32Array;
	readonly fadeIn: Float32Array; readonly fadeOut: Float32Array; readonly dissipation: Float32Array;
	readonly buoy: Float32Array; readonly drag: Float32Array; readonly opacity: Float32Array;
	readonly group: Uint8Array;
	readonly parent: Int32Array;
	readonly cdx: Float32Array; readonly cdy: Float32Array; readonly cdz: Float32Array; readonly cscale: Float32Array;
	/** Previous positions and effective (kinematic + momentum) velocity, used to advect detail noise. */
	readonly ppx: Float32Array; readonly ppy: Float32Array; readonly ppz: Float32Array;
	readonly ex: Float32Array; readonly ey: Float32Array; readonly ez: Float32Array;
	private readonly alive: Uint8Array;
	private readonly remap: Int32Array;

	// --- aggregates (updated every frame) ---
	readonly boundsMin: Vec3Tuple = [ 0, 0, 0 ];
	readonly boundsMax: Vec3Tuple = [ 0, 0, 0 ];
	emission = 0;
	readonly emissionCentroid: Vec3Tuple = [ 0, 0, 0 ];
	emissionTemp = 0;
	/** Hottest live billow (normalised temperature). */
	maxTemperature = 0;
	flash = 0;
	/** Typical (median-ish) billow radius, used for noise scale and LOD. */
	typicalRadius = 1;

	private readonly rng: Rng;
	private readonly emitters: EmitterState[] = [];
	private readonly groupNames: string[] = [ '' ];
	private readonly groups: GroupStats[] = [];
	private readonly cosR: number;
	private readonly sinR: number;
	private readonly endTime: number;

	constructor( definition: EffectDefinition, origin: Vec3Tuple, options: SpawnOptions = {} ) {

		this.definition = definition;
		this.origin = [ origin[ 0 ], origin[ 1 ], origin[ 2 ] ];
		this.scale = options.scale ?? definition.scale ?? 1;
		this.rotation = options.rotation ?? 0;
		this.seed = options.seed ?? ( ( Math.random() * 0xffffffff ) >>> 0 );
		this.look = { ...definition.look, ...options.look };
		this.rng = new Rng( this.seed );
		this.cosR = Math.cos( this.rotation );
		this.sinR = Math.sin( this.rotation );

		for ( const e of definition.emitters ) {

			this.emitters.push( {
				def: e,
				group: this.groupId( e.group ?? e.name ?? '' ),
				sourceGroup: this.groupId( e.source ?? e.group ?? e.name ?? '' ),
				accumulator: 0,
				fired: false,
			} );

		}

		for ( const b of definition.behaviors ?? [] ) {

			this.groupId( b.group );
			if ( 'target' in b && b.target ) this.groupId( b.target );

		}

		for ( let i = 0; i < this.groupNames.length; i ++ ) this.groups.push( { cx: 0, cy: 0, cz: 0, hr: 0, minY: 0, maxY: 0, w: 0 } );

		const cap = VoluxelEffect.estimateCapacity( definition );
		this.capacity = cap;
		const f = () => new Float32Array( cap );
		this.px = f(); this.py = f(); this.pz = f();
		this.vx = f(); this.vy = f(); this.vz = f();
		this.r = f(); this.r0 = f(); this.rMax = f(); this.growth = f(); this.growthDecay = f();
		this.dens = f(); this.dens0 = f();
		this.temp = f(); this.temp0 = f(); this.cooling = f();
		this.soot = f();
		this.age = f(); this.life = f(); this.fadeIn = f(); this.fadeOut = f(); this.dissipation = f();
		this.buoy = f(); this.drag = f(); this.opacity = f();
		this.cdx = f(); this.cdy = f(); this.cdz = f(); this.cscale = f();
		this.ppx = f(); this.ppy = f(); this.ppz = f();
		this.ex = f(); this.ey = f(); this.ez = f();
		this.group = new Uint8Array( cap );
		this.parent = new Int32Array( cap );
		this.alive = new Uint8Array( cap );
		this.remap = new Int32Array( cap );

		let end = 0;
		for ( const e of definition.emitters ) end = Math.max( end, ( e.start ?? 0 ) + ( e.type === 'burst' ? 0 : e.duration ?? 0 ) );
		this.endTime = definition.duration ?? Infinity;
		this.emittersEnd = end;

		this.boundsMin[ 0 ] = this.boundsMax[ 0 ] = this.origin[ 0 ];
		this.boundsMin[ 1 ] = this.boundsMax[ 1 ] = this.origin[ 1 ];
		this.boundsMin[ 2 ] = this.boundsMax[ 2 ] = this.origin[ 2 ];

		if ( options.timeOffset && options.timeOffset > 0 ) {

			const step = 1 / 30;
			const ctx: SimContext = { wind: [ 0, 0, 0 ], groundHeight: origin[ 1 ] };
			for ( let t = 0; t < options.timeOffset; t += step ) this.update( step, ctx );

		}

	}

	private readonly emittersEnd: number;

	/** Upper bound of simultaneously alive billows for a definition. */
	static estimateCapacity( def: EffectDefinition ): number {

		let n = 0;
		for ( const e of def.emitters ) {

			const kids = 1 + ( e.children?.count ?? 0 );
			if ( e.type === 'burst' ) n += ( e.count ?? 0 ) * kids;
			else {

				const life = e.particle.life[ 1 ];
				const curveMax = Math.max( e.rateCurve?.[ 0 ] ?? 1, e.rateCurve?.[ 1 ] ?? 1 );
				const window = Math.min( e.duration ?? life, life );
				n += Math.ceil( ( e.rate ?? 0 ) * curveMax * window * 1.1 + 4 ) * kids;

			}

		}

		return clamp( n, 16, 16384 );

	}

	private groupId( name: string ): number {

		let i = this.groupNames.indexOf( name );
		if ( i < 0 ) {

			i = this.groupNames.length;
			this.groupNames.push( name );

		}

		return i;

	}

	get emitting(): boolean {

		return this.time < this.emittersEnd;

	}

	// -------------------------------------------------------------------------------------------
	// Spawning
	// -------------------------------------------------------------------------------------------

	private spawn( em: EmitterState, sourceIndex = - 1 ): number {

		if ( this.count >= this.capacity ) return - 1;

		const e = em.def;
		const rng = this.rng;
		const s = this.scale;
		const p = e.particle;
		const i = this.count ++;

		// --- position in emitter space (unscaled) ---
		let lx = 0, ly = 0, lz = 0;
		const R = e.radius ?? 0;
		let rdx = 0, rdy = 0, rdz = 0; // radial direction
		switch ( e.shape ) {

			case 'sphere':
			case 'hemisphere': {

				rng.dir( _dir );
				if ( e.shape === 'hemisphere' ) _dir[ 1 ] = Math.abs( _dir[ 1 ] );
				const d = R * Math.cbrt( rng.next() );
				lx = _dir[ 0 ] * d; ly = _dir[ 1 ] * d; lz = _dir[ 2 ] * d;
				rdx = _dir[ 0 ]; rdy = _dir[ 1 ]; rdz = _dir[ 2 ];
				break;

			}

			case 'disc': {

				const a = rng.next() * Math.PI * 2;
				const inner = e.thickness ?? 0;
				const d = Math.sqrt( inner * inner + ( R * R - inner * inner ) * rng.next() );
				lx = Math.cos( a ) * d; lz = Math.sin( a ) * d;
				rdx = Math.cos( a ); rdz = Math.sin( a );
				break;

			}

			case 'ring': {

				const a = rng.next() * Math.PI * 2;
				const d = R + ( rng.next() - 0.5 ) * ( e.thickness ?? 0 );
				lx = Math.cos( a ) * d; lz = Math.sin( a ) * d;
				rdx = Math.cos( a ); rdz = Math.sin( a );
				break;

			}

			case 'column': {

				const a = rng.next() * Math.PI * 2;
				const d = R * Math.sqrt( rng.next() );
				lx = Math.cos( a ) * d; lz = Math.sin( a ) * d;
				ly = rng.next() * ( e.thickness ?? 0 );
				rdx = Math.cos( a ); rdz = Math.sin( a );
				break;

			}

			default: {

				rng.dir( _dir );
				rdx = _dir[ 0 ]; rdy = _dir[ 1 ]; rdz = _dir[ 2 ];

			}

		}

		const ep = e.position ?? [ 0, 0, 0 ];
		lx += ep[ 0 ]; ly += ep[ 1 ]; lz += ep[ 2 ];

		let radius = rng.range( p.radius ) * s;

		// --- accretion: grow on the surface of an existing billow ---
		if ( e.type === 'accrete' && sourceIndex >= 0 ) {

			rng.dir( _dir );
			// bias outward from the group centroid and upward, like convective towers
			const g = this.groups[ em.sourceGroup ];
			let ox = this.px[ sourceIndex ] - g.cx, oy = this.py[ sourceIndex ] - g.cy, oz = this.pz[ sourceIndex ] - g.cz;
			const ol = Math.hypot( ox, oy, oz ) || 1;
			ox /= ol; oy /= ol; oz /= ol;
			let dx = _dir[ 0 ] + ox * 1.0, dy = Math.abs( _dir[ 1 ] ) * 0.5 + oy * 0.6 + 0.12, dz = _dir[ 2 ] + oz * 1.0;
			const dl = Math.hypot( dx, dy, dz ) || 1;
			dx /= dl; dy /= dl; dz /= dl;
			const sr = this.r[ sourceIndex ];
			radius = Math.min( radius, sr * 0.95 );
			const dist = sr * ( 0.55 + 0.3 * rng.next() );
			this.px[ i ] = this.px[ sourceIndex ] + dx * dist;
			this.py[ i ] = this.py[ sourceIndex ] + dy * dist;
			this.pz[ i ] = this.pz[ sourceIndex ] + dz * dist;
			rdx = dx; rdy = dy; rdz = dz;

		} else {

			// rotate (yaw) + scale + translate
			this.px[ i ] = this.origin[ 0 ] + ( lx * this.cosR - lz * this.sinR ) * s;
			this.py[ i ] = this.origin[ 1 ] + ly * s;
			this.pz[ i ] = this.origin[ 2 ] + ( lx * this.sinR + lz * this.cosR ) * s;
			const tx = rdx * this.cosR - rdz * this.sinR;
			rdz = rdx * this.sinR + rdz * this.cosR;
			rdx = tx;

		}

		// --- velocity ---
		const v = e.velocity;
		let vx = 0, vy = 0, vz = 0;
		if ( v ) {

			const radial = rng.range( v.radial ) * s;
			vx += rdx * radial; vy += rdy * radial; vz += rdz * radial;
			if ( v.directional ) {

				const d = v.direction ?? [ 0, 1, 0 ];
				const sp = rng.range( v.directional ) * s;
				vx += ( d[ 0 ] * this.cosR - d[ 2 ] * this.sinR ) * sp;
				vy += d[ 1 ] * sp;
				vz += ( d[ 0 ] * this.sinR + d[ 2 ] * this.cosR ) * sp;

			}

			if ( v.random ) {

				rng.dir( _dir );
				const sp = v.random * s * rng.next();
				vx += _dir[ 0 ] * sp; vy += _dir[ 1 ] * sp; vz += _dir[ 2 ] * sp;

			}

			if ( v.swirl ) {

				const sw = rng.range( v.swirl ) * s;
				const hl = Math.hypot( rdx, rdz ) || 1;
				vx += - rdz / hl * sw; vz += rdx / hl * sw;

			}

		}

		this.vx[ i ] = vx; this.vy[ i ] = vy; this.vz[ i ] = vz;
		this.ppx[ i ] = this.px[ i ]; this.ppy[ i ] = this.py[ i ]; this.ppz[ i ] = this.pz[ i ];

		this.r[ i ] = radius;
		this.r0[ i ] = radius;
		this.rMax[ i ] = radius * ( p.maxGrowth ?? 6 );
		this.growth[ i ] = rng.range( p.growth ) * s;
		this.growthDecay[ i ] = p.growthDecay ?? 0.6;
		this.dens0[ i ] = rng.range( p.density, 1 );
		this.dens[ i ] = 0;
		this.temp0[ i ] = rng.range( p.temperature );
		this.temp[ i ] = this.temp0[ i ];
		this.cooling[ i ] = p.cooling ?? 0.5;
		this.soot[ i ] = rng.range( p.soot );
		this.age[ i ] = 0;
		this.life[ i ] = Math.max( 0.05, rng.range( p.life, 1 ) );
		this.fadeIn[ i ] = p.fadeIn ?? 0.03;
		this.fadeOut[ i ] = p.fadeOut ?? 0.35;
		this.dissipation[ i ] = p.dissipation ?? 0;
		this.buoy[ i ] = p.buoyancy ?? 1;
		this.drag[ i ] = p.drag ?? 1;
		this.opacity[ i ] = p.opacity ?? 1;
		this.group[ i ] = em.group;
		this.parent[ i ] = - 1;
		this.alive[ i ] = 1;

		// --- sub-billows ---
		const c = e.children;
		if ( c && c.count > 0 ) {

			for ( let k = 0; k < c.count && this.count < this.capacity; k ++ ) {

				const j = this.count ++;
				rng.dir( _dir );
				if ( c.upBias ) _dir[ 1 ] = _dir[ 1 ] + ( Math.abs( _dir[ 1 ] ) - _dir[ 1 ] ) * c.upBias;
				const dl = Math.hypot( _dir[ 0 ], _dir[ 1 ], _dir[ 2 ] ) || 1;
				const dist = rng.range( c.distance );
				this.cdx[ j ] = _dir[ 0 ] / dl * dist;
				this.cdy[ j ] = _dir[ 1 ] / dl * dist;
				this.cdz[ j ] = _dir[ 2 ] / dl * dist;
				this.cscale[ j ] = rng.range( c.scale );
				this.parent[ j ] = i;
				this.group[ j ] = em.group;
				this.alive[ j ] = 1;
				this.dens0[ j ] = this.dens0[ i ] * ( 0.85 + 0.3 * rng.next() );
				this.opacity[ j ] = this.opacity[ i ];
				this.soot[ j ] = this.soot[ i ];
				this.temp0[ j ] = this.temp0[ i ] * ( 0.8 + 0.25 * rng.next() );
				this.life[ j ] = this.life[ i ];
				this.age[ j ] = 0;
				this.vx[ j ] = vx; this.vy[ j ] = vy; this.vz[ j ] = vz;
				this.r[ j ] = radius * this.cscale[ j ];
				this.px[ j ] = this.px[ i ] + this.cdx[ j ] * radius;
				this.py[ j ] = this.py[ i ] + this.cdy[ j ] * radius;
				this.pz[ j ] = this.pz[ i ] + this.cdz[ j ] * radius;
				this.ppx[ j ] = this.px[ j ]; this.ppy[ j ] = this.py[ j ]; this.ppz[ j ] = this.pz[ j ];
				this.dens[ j ] = 0;
				this.temp[ j ] = this.temp0[ j ];

			}

		}

		return i;

	}

	private runEmitters( dt: number ): void {

		const t = this.time;
		for ( const em of this.emitters ) {

			const e = em.def;
			const start = e.start ?? 0;
			if ( t < start ) continue;

			if ( e.type === 'burst' ) {

				if ( ! em.fired ) {

					em.fired = true;
					const n = e.count ?? 0;
					for ( let k = 0; k < n; k ++ ) if ( this.spawn( em ) < 0 ) break;

				}

				continue;

			}

			const duration = e.duration ?? Infinity;
			if ( t > start + duration ) continue;
			const u = Number.isFinite( duration ) ? clamp( ( t - start ) / duration, 0, 1 ) : 0;
			const curve = e.rateCurve ? e.rateCurve[ 0 ] + ( e.rateCurve[ 1 ] - e.rateCurve[ 0 ] ) * u : 1;
			em.accumulator += ( e.rate ?? 0 ) * curve * dt;

			while ( em.accumulator >= 1 ) {

				em.accumulator -= 1;
				if ( e.type === 'accrete' ) {

					const src = this.pickSource( em.sourceGroup );
					if ( src < 0 ) {

						this.spawn( em );

					} else this.spawn( em, src );

				} else if ( this.spawn( em ) < 0 ) break;

			}

		}

	}

	/** Random root billow from a group, preferring the outer, upper ones. */
	private pickSource( group: number ): number {

		if ( this.count === 0 ) return - 1;
		let best = - 1, bestScore = - Infinity;
		const g = this.groups[ group ];
		for ( let k = 0; k < 6; k ++ ) {

			const i = Math.floor( this.rng.next() * this.count );
			if ( this.parent[ i ] >= 0 || this.group[ i ] !== group || ! this.alive[ i ] ) continue;
			const score = Math.hypot( this.px[ i ] - g.cx, ( this.py[ i ] - g.cy ) * 0.7, this.pz[ i ] - g.cz ) + this.py[ i ] * 0.15 + this.rng.next() * this.r[ i ];
			if ( score > bestScore ) {

				bestScore = score;
				best = i;

			}

		}

		return best;

	}

	// -------------------------------------------------------------------------------------------
	// Simulation
	// -------------------------------------------------------------------------------------------

	update( dt: number, ctx: SimContext ): void {

		if ( this.finished ) return;
		this.time += dt;

		this.ppx.set( this.px.subarray( 0, this.count ) );
		this.ppy.set( this.py.subarray( 0, this.count ) );
		this.ppz.set( this.pz.subarray( 0, this.count ) );

		if ( ! this.killed ) this.runEmitters( dt );

		const def = this.definition;
		const ph = def.physics;
		const s = this.scale;
		const gravity = ( ph.gravity ?? 0 ) * s;
		const buoyancy = ( ph.buoyancy ?? 6 ) * s;
		const drag = ph.drag ?? 0.8;
		const qdrag = ( ph.quadraticDrag ?? 0 ) / s;
		const turbAmp = ( ph.turbulence?.amplitude ?? 0 ) * s;
		const turbFreq = ( ph.turbulence?.frequency ?? 0.1 ) / s;
		const turbSpeed = ph.turbulence?.speed ?? 1;
		const windInf = ph.windInfluence ?? 0.5;
		const wx = ctx.wind[ 0 ] * windInf, wy = ctx.wind[ 1 ] * windInf, wz = ctx.wind[ 2 ] * windInf;
		const groundFriction = ph.groundFriction ?? 1.5;
		const groundSink = ph.groundSink ?? 0.35;
		const ground = ctx.groundHeight;
		const t = this.time;

		this.computeGroups();

		const n = this.count;
		const px = this.px, py = this.py, pz = this.pz, vx = this.vx, vy = this.vy, vz = this.vz;

		// --- roots: forces & integration ---
		for ( let i = 0; i < n; i ++ ) {

			if ( this.parent[ i ] >= 0 ) continue;

			const age = ( this.age[ i ] += dt );
			const life = this.life[ i ];
			if ( age >= life || this.killed ) {

				this.alive[ i ] = 0;
				continue;

			}

			// temperature & density envelopes
			const temp = this.temp0[ i ] * Math.exp( - this.cooling[ i ] * age );
			this.temp[ i ] = temp;
			const u = age / life;
			const fi = this.fadeIn[ i ], fo = this.fadeOut[ i ];
			const env = ( fi > 0 ? smoothstep( 0, fi, u ) : 1 ) * ( fo > 0 ? 1 - smoothstep( 1 - fo, 1, u ) : 1 );
			this.dens[ i ] = this.dens0[ i ] * env * Math.exp( - this.dissipation[ i ] * age );

			// radius growth with decaying rate
			const gdec = this.growthDecay[ i ];
			const grow = this.growth[ i ] * Math.exp( - gdec * age );
			this.r[ i ] = Math.min( this.rMax[ i ], this.r[ i ] + grow * dt );

			// accelerations
			let ax = 0, ay = 0, az = 0;
			ay += buoyancy * this.buoy[ i ] * temp - gravity;

			const d = drag * this.drag[ i ];
			const sp = Math.hypot( vx[ i ], vy[ i ], vz[ i ] );
			const damp = Math.exp( - ( d + qdrag * sp ) * dt );
			vx[ i ] = ( vx[ i ] + ax * dt ) * damp;
			vy[ i ] = ( vy[ i ] + ay * dt ) * damp;
			vz[ i ] = ( vz[ i ] + az * dt ) * damp;

			// kinematic flow: turbulence + wind
			let fx = wx, fy = wy, fz = wz;
			if ( turbAmp > 0 ) {

				turbulence( px[ i ] * turbFreq, py[ i ] * turbFreq, pz[ i ] * turbFreq, t * turbSpeed, _turb );
				const ta = turbAmp * ( 0.4 + 0.6 * Math.min( 1, age * 2 ) );
				fx += _turb[ 0 ] * ta; fy += _turb[ 1 ] * ta; fz += _turb[ 2 ] * ta;

			}

			px[ i ] += ( vx[ i ] + fx ) * dt;
			py[ i ] += ( vy[ i ] + fy ) * dt;
			pz[ i ] += ( vz[ i ] + fz ) * dt;

			// ground
			const minY = ground + this.r[ i ] * ( 1 - groundSink ) * 0.6;
			if ( py[ i ] < minY ) {

				py[ i ] = minY;
				if ( vy[ i ] < 0 ) vy[ i ] = 0;
				const f = Math.exp( - groundFriction * dt );
				vx[ i ] *= f; vz[ i ] *= f;

			}

		}

		this.applyBehaviors( dt );

		// --- children follow their parent ---
		for ( let j = 0; j < n; j ++ ) {

			const p = this.parent[ j ];
			if ( p < 0 ) continue;
			if ( ! this.alive[ p ] ) {

				this.alive[ j ] = 0;
				continue;

			}

			const pr = this.r[ p ];
			px[ j ] = px[ p ] + this.cdx[ j ] * pr;
			py[ j ] = py[ p ] + this.cdy[ j ] * pr;
			pz[ j ] = pz[ p ] + this.cdz[ j ] * pr;
			const minY = ground + this.r[ j ] * 0.25;
			if ( py[ j ] < minY ) py[ j ] = minY;
			this.r[ j ] = pr * this.cscale[ j ];
			this.age[ j ] = this.age[ p ];
			const pd = this.dens0[ p ] > 0 ? this.dens[ p ] / this.dens0[ p ] : 0;
			this.dens[ j ] = this.dens0[ j ] * pd;
			this.temp[ j ] = this.temp0[ j ] * ( this.temp0[ p ] > 0 ? this.temp[ p ] / this.temp0[ p ] : 0 );
			vx[ j ] = vx[ p ]; vy[ j ] = vy[ p ]; vz[ j ] = vz[ p ];

		}

		const invDt = dt > 0 ? 1 / dt : 0;
		for ( let i = 0; i < n; i ++ ) {

			this.ex[ i ] = ( px[ i ] - this.ppx[ i ] ) * invDt;
			this.ey[ i ] = ( py[ i ] - this.ppy[ i ] ) * invDt;
			this.ez[ i ] = ( pz[ i ] - this.ppz[ i ] ) * invDt;

		}

		this.compact();
		this.computeAggregates();

		if ( ( this.count === 0 && ! this.emitting && this.time > 0.1 ) || this.time > this.endTime || ( this.killed && this.count === 0 ) ) {

			this.finished = true;

		}

	}

	private applyBehaviors( dt: number ): void {

		const behaviors = this.definition.behaviors;
		if ( ! behaviors ) return;
		const s = this.scale;
		for ( let k = 0; k < behaviors.length; k ++ ) {

			const b = behaviors[ k ];
			const start = b.start ?? 0;
			const dur = b.duration ?? Infinity;
			if ( this.time < start || this.time > start + dur ) continue;
			const fade = Number.isFinite( dur ) ? 1 - smoothstep( 0.6, 1, ( this.time - start ) / dur ) : 1;
			this.applyBehavior( b, k, dt, s * fade );

		}

	}

	/** Per-behaviour state (vortex ring radius). */
	private readonly behaviorState: number[] = [];

	private applyBehavior( b: BehaviorDefinition, k: number, dt: number, s: number ): void {

		const gid = this.groupNames.indexOf( b.group );
		if ( gid < 0 ) return;
		const g = this.groups[ gid ];
		if ( g.w <= 0 ) return;
		const n = this.count;
		const px = this.px, py = this.py, pz = this.pz;

		if ( b.type === 'vortexRing' ) {

			// The ring radius is state, not re-derived from the group spread every frame: deriving it
			// from the spread lets entrainment feed on itself and the cap tears apart.
			const since = this.time - ( b.start ?? 0 );
			let R = this.behaviorState[ k ];
			if ( ! ( R > 0 ) ) R = Math.max( 1e-3, g.hr * ( b.radiusFactor ?? 0.75 ) );
			const grow = ( b.expansion ?? 0 ) * s * Math.exp( - since / 8 );
			R += grow * dt;
			this.behaviorState[ k ] = R;

			const core = R * ( b.coreFactor ?? 0.45 );
			const tube = core * 2.0; // cap thickness around the ring core
			const strength = b.strength * s;
			// ring core sits slightly below the cap centroid
			const cy = g.cy - R * 0.1;
			for ( let i = 0; i < n; i ++ ) {

				if ( this.group[ i ] !== gid || this.parent[ i ] >= 0 || ! this.alive[ i ] ) continue;
				const rx = px[ i ] - g.cx, rz = pz[ i ] - g.cz, dy = py[ i ] - cy;
				const rho = Math.hypot( rx, rz ) || 1e-4;
				const qx = rho - R, qy = dy;
				const ql = Math.hypot( qx, qy ) || 1e-4;
				const sN = ql / core;
				const mag = strength * ( sN < 1 ? sN : 1 / ( sN * sN ) );
				// poloidal roll (qy, -qx): up through the centre, out over the top, down outside;
				// radial stretch follows the ring growth
				let vr = ( qy / ql ) * mag + grow * Math.min( rho / R, 1.3 );
				let vy = ( - qx / ql ) * mag;
				// cohesion: billows that drifted out of the cap tube are drawn back toward the core
				const out = ql - tube;
				if ( out > 0 ) {

					const pull = Math.min( out * 0.6, strength * 0.8 );
					vr -= ( qx / ql ) * pull;
					vy -= ( qy / ql ) * pull;

				}

				px[ i ] += ( rx / rho ) * vr * dt;
				pz[ i ] += ( rz / rho ) * vr * dt;
				py[ i ] += vy * dt;

			}

		} else if ( b.type === 'updraft' ) {

			let tx = g.cx, tz = g.cz, ty = Infinity;
			if ( b.target ) {

				const tg = this.groups[ this.groupNames.indexOf( b.target ) ];
				if ( tg && tg.w > 0 ) {

					tx = tg.cx; tz = tg.cz; ty = tg.minY + ( tg.cy - tg.minY ) * 0.5;

				}

			}

			const up = b.strength * s;
			const inflow = ( b.inflow ?? 0 ) * s;
			for ( let i = 0; i < n; i ++ ) {

				if ( this.group[ i ] !== gid || this.parent[ i ] >= 0 || ! this.alive[ i ] ) continue;
				const rx = tx - px[ i ], rz = tz - pz[ i ];
				const rl = Math.hypot( rx, rz ) || 1e-4;
				const below = py[ i ] < ty ? 1 : Math.max( 0, 1 - ( py[ i ] - ty ) / ( this.r[ i ] * 2 + 1e-3 ) );
				py[ i ] += up * below * dt;
				const pull = Math.min( rl, inflow * dt );
				px[ i ] += ( rx / rl ) * pull;
				pz[ i ] += ( rz / rl ) * pull;

			}

		} else if ( b.type === 'attract' ) {

			const tg = this.groups[ this.groupNames.indexOf( b.target ) ];
			if ( ! tg || tg.w <= 0 ) return;
			const k = b.strength * s * dt;
			for ( let i = 0; i < n; i ++ ) {

				if ( this.group[ i ] !== gid || this.parent[ i ] >= 0 ) continue;
				const dx = tg.cx - px[ i ], dy = tg.cy - py[ i ], dz = tg.cz - pz[ i ];
				const l = Math.hypot( dx, dy, dz ) || 1;
				this.vx[ i ] += dx / l * k;
				this.vy[ i ] += dy / l * k;
				this.vz[ i ] += dz / l * k;

			}

		}

	}

	private computeGroups(): void {

		const groups = this.groups;
		for ( const g of groups ) {

			g.cx = g.cy = g.cz = g.hr = g.w = 0;
			g.minY = Infinity; g.maxY = - Infinity;

		}

		const n = this.count;
		for ( let i = 0; i < n; i ++ ) {

			if ( this.parent[ i ] >= 0 ) continue;
			const g = groups[ this.group[ i ] ];
			const w = this.r[ i ] * this.r[ i ] * this.r[ i ] + 1e-6;
			g.cx += this.px[ i ] * w; g.cy += this.py[ i ] * w; g.cz += this.pz[ i ] * w; g.w += w;
			if ( this.py[ i ] < g.minY ) g.minY = this.py[ i ];
			if ( this.py[ i ] > g.maxY ) g.maxY = this.py[ i ];

		}

		for ( const g of groups ) if ( g.w > 0 ) {

			g.cx /= g.w; g.cy /= g.w; g.cz /= g.w;

		}

		for ( let i = 0; i < n; i ++ ) {

			if ( this.parent[ i ] >= 0 ) continue;
			const g = groups[ this.group[ i ] ];
			const w = this.r[ i ] * this.r[ i ] * this.r[ i ] + 1e-6;
			const dx = this.px[ i ] - g.cx, dz = this.pz[ i ] - g.cz;
			g.hr += ( dx * dx + dz * dz ) * w;

		}

		for ( const g of groups ) if ( g.w > 0 ) g.hr = Math.sqrt( g.hr / g.w );

	}

	/** Stable compaction: keeps parent < child ordering so attachments stay valid. */
	private compact(): void {

		const n = this.count;
		let w = 0;
		const remap = this.remap;
		for ( let i = 0; i < n; i ++ ) {

			let keep = this.alive[ i ] === 1;
			const p = this.parent[ i ];
			if ( keep && p >= 0 ) keep = remap[ p ] >= 0;
			if ( ! keep ) {

				remap[ i ] = - 1;
				continue;

			}

			remap[ i ] = w;
			if ( w !== i ) this.move( i, w );
			if ( p >= 0 ) this.parent[ w ] = remap[ p ];
			w ++;

		}

		this.count = w;

	}

	private move( from: number, to: number ): void {

		this.px[ to ] = this.px[ from ]; this.py[ to ] = this.py[ from ]; this.pz[ to ] = this.pz[ from ];
		this.vx[ to ] = this.vx[ from ]; this.vy[ to ] = this.vy[ from ]; this.vz[ to ] = this.vz[ from ];
		this.r[ to ] = this.r[ from ]; this.r0[ to ] = this.r0[ from ]; this.rMax[ to ] = this.rMax[ from ];
		this.growth[ to ] = this.growth[ from ]; this.growthDecay[ to ] = this.growthDecay[ from ];
		this.dens[ to ] = this.dens[ from ]; this.dens0[ to ] = this.dens0[ from ];
		this.temp[ to ] = this.temp[ from ]; this.temp0[ to ] = this.temp0[ from ]; this.cooling[ to ] = this.cooling[ from ];
		this.soot[ to ] = this.soot[ from ];
		this.age[ to ] = this.age[ from ]; this.life[ to ] = this.life[ from ];
		this.fadeIn[ to ] = this.fadeIn[ from ]; this.fadeOut[ to ] = this.fadeOut[ from ]; this.dissipation[ to ] = this.dissipation[ from ];
		this.buoy[ to ] = this.buoy[ from ]; this.drag[ to ] = this.drag[ from ]; this.opacity[ to ] = this.opacity[ from ];
		this.group[ to ] = this.group[ from ]; this.parent[ to ] = this.parent[ from ];
		this.cdx[ to ] = this.cdx[ from ]; this.cdy[ to ] = this.cdy[ from ]; this.cdz[ to ] = this.cdz[ from ]; this.cscale[ to ] = this.cscale[ from ];
		this.ppx[ to ] = this.ppx[ from ]; this.ppy[ to ] = this.ppy[ from ]; this.ppz[ to ] = this.ppz[ from ];
		this.ex[ to ] = this.ex[ from ]; this.ey[ to ] = this.ey[ from ]; this.ez[ to ] = this.ez[ from ];
		this.alive[ to ] = this.alive[ from ];

	}

	private computeAggregates(): void {

		const n = this.count;
		let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = - Infinity, y1 = - Infinity, z1 = - Infinity;
		let e = 0, ex = 0, ey = 0, ez = 0, et = 0, tMax = 0;
		let rs = 0, rw = 0;
		for ( let i = 0; i < n; i ++ ) {

			const r = this.r[ i ];
			if ( this.dens[ i ] <= 1e-4 ) continue;
			const x = this.px[ i ], y = this.py[ i ], z = this.pz[ i ];
			if ( x - r < x0 ) x0 = x - r; if ( x + r > x1 ) x1 = x + r;
			if ( y - r < y0 ) y0 = y - r; if ( y + r > y1 ) y1 = y + r;
			if ( z - r < z0 ) z0 = z - r; if ( z + r > z1 ) z1 = z + r;
			const T = this.temp[ i ];
			if ( T > tMax ) tMax = T;
			if ( T > 0.18 ) {

				const k = ( T - 0.18 );
				const w = this.dens[ i ] * k * k * k * r * r;
				e += w; ex += x * w; ey += y * w; ez += z * w; et += T * w;

			}

			if ( this.parent[ i ] < 0 ) {

				rs += r; rw ++;

			}

		}

		if ( x0 === Infinity ) {

			x0 = x1 = this.origin[ 0 ]; y0 = y1 = this.origin[ 1 ]; z0 = z1 = this.origin[ 2 ];

		}

		this.boundsMin[ 0 ] = x0; this.boundsMin[ 1 ] = y0; this.boundsMin[ 2 ] = z0;
		this.boundsMax[ 0 ] = x1; this.boundsMax[ 1 ] = y1; this.boundsMax[ 2 ] = z1;
		this.emission = e;
		this.maxTemperature = tMax;
		if ( e > 0 ) {

			this.emissionCentroid[ 0 ] = ex / e; this.emissionCentroid[ 1 ] = ey / e; this.emissionCentroid[ 2 ] = ez / e;
			this.emissionTemp = et / e;

		}

		if ( rw > 0 ) this.typicalRadius = rs / rw;

		const fl = this.definition.flash;
		this.flash = fl ? fl.intensity * Math.exp( - this.time / Math.max( 0.01, fl.duration ) * 3 ) : 0;

	}

	/** Number of live billows contributing density. */
	get liveCount(): number {

		return this.count;

	}

	/** Requests a graceful stop: emitters stop and existing billows die out immediately. */
	kill(): void {

		this.killed = true;

	}

}
