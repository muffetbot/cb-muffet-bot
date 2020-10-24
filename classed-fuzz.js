class Analyzer {
	scores = [];

	static avg(arr) {
		return arr.reduce((a, c) => (a += c)) / arr.length;
	}

	get match_scores() {
		return this.scores.filter(Boolean);
	}

	get match_ratio() {
		return this.match_scores.length / this.scores.length;
	}

	get mean() {
		return Analyzer.avg(this.scores);
	}

	get match_mean() {
		return Analyzer.avg(this.match_scores);
	}

	get min_max() {
		const pos = this.match_scores;
		return [Math.min(...pos), Math.max(...pos)];
	}

	get range() {
		const [min, max] = this.min_max;
		return max - min;
	}

	get std_deviation() {
		const mean = this.mean;
		const variance = Analyzer.avg(this.scores.map(s => Math.pow(s - mean, 2)));
		return Math.sqrt(variance);
	}

	get match_std_deviation() {
		const mean = this.match_mean;
		const variance = Analyzer.avg(this.match_scores.map(s => Math.pow(s - mean, 2)));
		return Math.sqrt(variance);
	}

	get z_scores() {
		const mean = this.mean,
			std_dev = this.std_deviation;
		return this.scores.map(s => s - mean / std_dev);
	}

	get match_z_scores() {
		const mean = this.match_mean,
			std_dev = this.match_std_deviation;
		return this.scores.map(s => s - mean / std_dev);
	}

	plot() {
		let stats = {};
		for (const attr of [
			'scores',
			'z_scores',
			'match_z_scores',
			'match_ratio',
			'mean',
			'match_mean',
			'min_max',
			'range',
			'std_deviation',
			'match_std_deviation',
		]) {
			stats[attr] = this[attr];
		}

		return stats;
	}
}

class Fuzzy extends Analyzer {
	static prepared_query_cache = new Map();
	matches_simple = [];
	matches_strict = [];

	constructor(target, ...queries) {
		super();
		this.target = target;
		this.queries = [...queries].map(q => Fuzzy.getPreparedQuery(q));
		return this;
	}

	algorithm(query_lower_codes) {
		const target_lower_codes = this.target_lower_codes,
			query_len = query_lower_codes.length,
			target_len = target_lower_codes.length;

		let query_i = 0,
			target_i = 0,
			typo_simple_i = 0,
			matches_simple_len = 0;
		let query_lower_code = query_lower_codes[0];

		while (true) {
			let is_match = query_lower_code === target_lower_codes[target_i];
			if (is_match) {
				this.matches_simple[matches_simple_len++] = target_i;
				++query_i;
				if (query_i === query_len) break;
				query_lower_code =
					query_lower_codes[
						!typo_simple_i ? query_i : typo_simple_i === query_i ? query_i - 1 : query_i
					];
			}

			++target_i;
			if (target_i >= target_len) {
				while (true) {
					if (query_i <= 1) return 0;
					let query_lower_code_new;
					if (!typo_simple_i) {
						--query_i;
						query_lower_code_new = query_lower_codes[query_i];
						if (query_lower_code === query_lower_code_new) continue;
						typo_simple_i = query_i;
					} else {
						if (typo_simple_i === 1) return 0;
						--typo_simple_i;
						query_i = typo_simple_i;
						query_lower_code = query_lower_codes[query_i + 1];
						query_lower_code_new = query_lower_codes[query_i];
						if (query_lower_code === query_lower_code_new) continue;
					}

					matches_simple_len = query_i;
					target_i = this.matches_simple[matches_simple_len - 1] + 1;
					break;
				}
			}
		}

		query_i = 0;
		let typo_strict_i = 0,
			matches_strict_len = 0,
			success_strict = false;
		const next_beginning_indexes = this.next_beginning_indexes;

		const first_possible_i =
			this.matches_simple[0] === 0 ? 0 : next_beginning_indexes[this.matches_simple[0] - 1];
		target_i = first_possible_i;

		if (target_i !== target_len)
			while (true) {
				if (target_i >= target_len) {
					if (query_i <= 0) {
						++typo_strict_i;
						if (typo_strict_i > query_len - 2) break;
						if (query_lower_codes[typo_strict_i] === query_lower_codes[typo_strict_i + 1]) continue;
						query_i = first_possible_i;
						continue;
					}

					--query_i;
					let last_match = this.matches_strict[--matches_strict_len];
					target_i = next_beginning_indexes[last_match];
				} else {
					let is_match =
						query_lower_codes[
							!typo_strict_i
								? query_i
								: typo_strict_i === query_i
								? query_i + 1
								: typo_strict_i === query_i - 1
								? query_i - 1
								: query_i
						] === target_lower_codes[target_i];

					if (is_match) {
						this.matches_strict[matches_strict_len++] = target_i;
						++query_i;
						if (query_i === query_len) {
							success_strict = true;
							break;
						}
						++target_i;
					} else {
						target_i = next_beginning_indexes[target_i];
					}
				}
				if (target_i === undefined) break;
			}

		{
			const matches_best = success_strict ? this.matches_strict : this.matches_simple;

			let score = 0,
				last_target_i = -1;
			for (let i = 0; i < query_len; ++i) {
				target_i = matches_best[i];
				if (last_target_i !== target_i - 1) score -= target_i;
				last_target_i = target_i;
			}

			if (!success_strict) {
				score *= 1000;
				if (typo_simple_i) score -= 20;
			} else {
				if (typo_strict_i) score -= 20;
			}

			score -= target_len - query_len;
			return score;
		}
	}

	algorithmPunishTypo(query_lower_codes) {
		const target_lower_codes = this.target_lower_codes,
			query_len = query_lower_codes.length,
			target_len = target_lower_codes.length;

		let query_i = 0,
			target_i = 0,
			matches_simple_len = 0,
			query_lower_code = query_lower_codes[0];

		while (true) {
			let is_match = query_lower_code === target_lower_codes[target_i];
			if (is_match) {
				this.matches_simple[matches_simple_len++] = target_i;
				++query_i;
				if (query_i === query_len) break;
				query_lower_code = query_lower_codes[query_i];
			}

			++target_i;
			if (target_i >= target_len) return 0;
		}

		query_i = 0;
		let matches_strict_len = 0,
			success_strict = false;
		const next_beginning_indexes = this.next_beginning_indexes;

		target_i =
			this.matches_simple[0] === 0 ? 0 : next_beginning_indexes[this.matches_simple[0] - 1];

		if (target_i !== target_len)
			while (true) {
				if (target_i >= target_len) {
					if (query_i <= 0) break;

					--query_i;
					let last_match = this.matches_strict[--matches_strict_len];
					target_i = next_beginning_indexes[last_match];
				} else {
					let is_match = query_lower_codes[query_i] === target_lower_codes[target_i];

					if (is_match) {
						this.matches_strict[matches_strict_len++] = target_i;
						++query_i;
						if (query_i === query_len) {
							success_strict = true;
							break;
						}
						++target_i;
					} else {
						target_i = next_beginning_indexes[target_i];
					}
				}
			}
		{
			const matches_best = success_strict ? this.matches_strict : this.matches_simple;

			let score = 0,
				last_target_i = -1;
			for (let i = 0; i < query_len; ++i) {
				target_i = matches_best[i];
				if (last_target_i !== target_i - 1) score -= target_i;
				last_target_i = target_i;
			}

			if (!success_strict) score *= 1000;

			score -= target_len - query_len;
			return score;
		}
	}

	static getPreparedQuery(query) {
		if (query.length > 999) return this.prepareLowerCodes(query);
		let query_prepared = this.prepared_query_cache.get(query);
		if (query_prepared !== undefined) return query_prepared;
		query_prepared = this.prepareLowerCodes(query);
		this.prepared_query_cache.set(query, query_prepared);
		return query_prepared;
	}

	set target(target) {
		this._target = target;
		this.target_len = target.length;

		this.target_lower_codes = Fuzzy.prepareLowerCodes(target);
		this.next_beginning_indexes = this.prepareNextBeginningIndexes(target);
	}

	static prepareLowerCodes(str) {
		const str_len = str.length,
			lower_codes = [],
			lower = str.toLowerCase();
		for (let i = 0; i < str_len; i++) {
			lower_codes[i] = lower.charCodeAt(i);
		}
		return lower_codes;
	}

	prepareBeginningIndexes() {
		const beginning_indexes = [];

		let beginning_indexes_len = 0,
			was_upper = false,
			was_alpha_num = false;

		for (let i = 0; i < this.target_len; i++) {
			let target_code = this._target.charCodeAt(i),
				is_upper = target_code >= 65 && target_code <= 90,
				is_alpha_num =
					is_upper ||
					(target_code >= 97 && target_code <= 122) ||
					(target_code >= 48 && target_code <= 57),
				is_beginning = (is_upper && !was_upper) || !was_alpha_num || !is_alpha_num;

			was_upper = is_upper;
			was_alpha_num = is_alpha_num;
			if (is_beginning) beginning_indexes[beginning_indexes_len++] = i;
		}
		return beginning_indexes;
	}

	prepareNextBeginningIndexes() {
		const beginning_indexes = this.prepareBeginningIndexes(),
			next_beginning_indexes = [];

		let last_is_beginning = beginning_indexes[0],
			last_is_beginning_i = 0;

		for (let i = 0; i < this.target_len; i++) {
			if (last_is_beginning > i) {
				next_beginning_indexes[i] = last_is_beginning;
			} else {
				last_is_beginning = beginning_indexes[++last_is_beginning_i];
				next_beginning_indexes[i] = last_is_beginning ?? this.target_len;
			}
		}
		return next_beginning_indexes;
	}

	cleanup() {
		this.matches_simple.length = this.matches_strict.length = 0;
	}

	static clear() {
		this.prepared_query_cache.clear();
	}

	run(allow_typo = true) {
		for (const query of this.queries) {
			const score = allow_typo ? this.algorithm(query) : this.algorithmPunishTypo(query);
			this.scores.push(score);
		}
		return this;
	}
}

const TEST_MSG = 'Hi first time in your how room miss muffet, are you new? old are you?';
const FUZZY_ARGS = 'how firts muffet giraffe lights'.split(' ');

function test() {
	const fuzz = new Fuzzy(TEST_MSG, ...FUZZY_ARGS);
	return fuzz.run().plot();
}

const results = test();
console.table(results);
