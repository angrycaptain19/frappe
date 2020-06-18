frappe.ui.Filter = class {
	constructor(opts) {
		$.extend(this, opts);
		if (this.value === null || this.value === undefined) {
			this.value = '';
		}

		this.utils = frappe.ui.filter_utils;
		this.set_conditions();
		this.set_conditions_from_config();
		this.make();
	}

	set_conditions() {
		this.conditions = [
			['=', __('Equals')],
			['!=', __('Not Equals')],
			['like', __('Like')],
			['not like', __('Not Like')],
			['in', __('In')],
			['not in', __('Not In')],
			['is', __('Is')],
			['>', '>'],
			['<', '<'],
			['>=', '>='],
			['<=', '<='],
			['Between', __('Between')],
			['Timespan', __('Timespan')],
		];

		this.nested_set_conditions = [
			['descendants of', __('Descendants Of')],
			['not descendants of', __('Not Descendants Of')],
			['ancestors of', __('Ancestors Of')],
			['not ancestors of', __('Not Ancestors Of')],
		];

		this.conditions.push(...this.nested_set_conditions);

		this.invalid_condition_map = {
			Date: ['like', 'not like'],
			Datetime: ['like', 'not like'],
			Data: ['Between', 'Timespan'],
			Select: ['like', 'not like', 'Between', 'Timespan'],
			Link: ['Between', 'Timespan', '>', '<', '>=', '<='],
			Currency: ['Between', 'Timespan'],
			Color: ['Between', 'Timespan'],
			Check: this.conditions.map((c) => c[0]).filter((c) => c !== '='),
		};
	}

	set_conditions_from_config() {
		if (frappe.boot.additional_filters_config) {
			this.filters_config = frappe.boot.additional_filters_config;
			for (let key of Object.keys(this.filters_config)) {
				const filter = this.filters_config[key];
				this.conditions.push([key, __(`{0}`, [filter.label])]);
				for (let fieldtype of Object.keys(this.invalid_condition_map)) {
					if (!filter.valid_for_fieldtypes.includes(fieldtype)) {
						this.invalid_condition_map[fieldtype].push(filter.label);
					}
				}
			}
		}
	}

	make() {
		this.filter_edit_area = $(
			frappe.render_template('edit_filter', {
				conditions: this.conditions,
			})
		)
		this.parent && this.filter_edit_area.appendTo(this.parent.find('.filter-edit-area'));
		this.make_select();
		this.set_events();
		this.setup();
	}

	make_select() {
		this.fieldselect = new frappe.ui.FieldSelect({
			parent: this.filter_edit_area.find('.fieldname-select-area'),
			doctype: this.parent_doctype,
			filter_fields: this.filter_fields,
			input_class: 'input-xs',
			select: (doctype, fieldname) => {
				this.set_field(doctype, fieldname);
			},
		});

		if (this.fieldname) {
			this.fieldselect.set_value(this.doctype, this.fieldname);
		}
	}

	set_events() {
		this.filter_edit_area.find('span.remove-filter').on('click', () => {
			this.remove();
		});

		this.filter_edit_area.find('.condition').change(() => {
			if (!this.field) return;

			let condition = this.get_condition();
			let fieldtype = null;

			if (['in', 'like', 'not in', 'not like'].includes(condition)) {
				fieldtype = 'Data';
				this.add_condition_help(condition);
			}

			if (
				['Select', 'MultiSelect'].includes(this.field.df.fieldtype) &&
				['in', 'not in'].includes(condition)
			) {
				fieldtype = 'MultiSelect';
			}

			this.set_field(
				this.field.df.parent,
				this.field.df.fieldname,
				fieldtype,
				condition
			);
		});
	}

	setup() {
		const fieldname = this.fieldname || 'name';
		// set the field
		return this.set_values(this.doctype, fieldname, this.condition, this.value);
	}

	remove() {
		this.filter_edit_area.remove();
		this.field = null;
		// this.on_change(true);
	}

	set_values(doctype, fieldname, condition, value) {
		// presents given (could be via tags!)
		if (this.set_field(doctype, fieldname) === false) {
			return;
		}

		if (this.field.df.original_type === 'Check') {
			value = value == 1 ? 'Yes' : 'No';
		}
		if (condition) this.set_condition(condition, true);

		// set value can be asynchronous, so update_filter_tag should happen after field is set
		this._filter_value_set = Promise.resolve();

		if (['in', 'not in'].includes(condition) && Array.isArray(value)) {
			value = value.join(',');
		}

		if (Array.isArray(value)) {
			this._filter_value_set = this.field.set_value(value);
		} else if (value !== undefined || value !== null) {
			this._filter_value_set = this.field.set_value((value + '').trim());
		}
		return this._filter_value_set;
	}

	set_field(doctype, fieldname, fieldtype, condition) {
		// set in fieldname (again)
		let cur = {};
		if (this.field) for (let k in this.field.df) cur[k] = this.field.df[k];

		let original_docfield = (this.fieldselect.fields_by_name[doctype] || {})[
			fieldname
		];

		if (!original_docfield) {
			console.warn(`Field ${fieldname} is not selectable.`);
			this.remove();
			return false;
		}

		let df = copy_dict(original_docfield);

		// filter field shouldn't be read only or hidden
		df.read_only = 0;
		df.hidden = 0;
		df.is_filter = true;

		let c = condition ? condition : this.utils.get_default_condition(df);
		this.set_condition(c);

		this.utils.set_fieldtype(df, fieldtype, this.get_condition());

		// called when condition is changed,
		// don't change if all is well
		if (
			this.field &&
			cur.fieldname == fieldname &&
			df.fieldtype == cur.fieldtype &&
			df.parent == cur.parent &&
			df.options == cur.options
		) {
			return;
		}

		// clear field area and make field
		this.fieldselect.selected_doctype = doctype;
		this.fieldselect.selected_fieldname = fieldname;

		if (
			this.filters_config &&
			this.filters_config[condition] &&
			this.filters_config[condition].valid_for_fieldtypes.includes(df.fieldtype)
		) {
			let args = {};
			if (this.filters_config[condition].depends_on) {
				const field_name = this.filters_config[condition].depends_on;
				const filter_value = this.base_list.get_filter_value(field_name);
				args[field_name] = filter_value;
			}
			frappe
				.xcall(this.filters_config[condition].get_field, args)
				.then((field) => {
					df.fieldtype = field.fieldtype;
					df.options = field.options;
					df.fieldname = fieldname;
					this.make_field(df, cur.fieldtype);
				});
		} else {
			this.make_field(df, cur.fieldtype);
		}
	}

	make_field(df, old_fieldtype) {
		let old_text = this.field ? this.field.get_value() : null;
		this.hide_invalid_conditions(df.fieldtype, df.original_type);
		this.toggle_nested_set_conditions(df);
		let field_area = this.filter_edit_area
			.find('.filter-field')
			.empty()
			.get(0);
		df.input_class = 'input-xs';
		let f = frappe.ui.form.make_control({
			df: df,
			parent: field_area,
			only_input: true,
		});
		f.refresh();

		this.field = f;
		if (old_text && f.fieldtype === old_fieldtype) {
			this.field.set_value(old_text);
		}

	}

	get_value() {
		return [
			this.fieldselect.selected_doctype,
			this.field.df.fieldname,
			this.get_condition(),
			this.get_selected_value(),
			this.hidden,
		];
	}

	get_selected_value() {
		return this.utils.get_selected_value(this.field, this.get_condition());
	}

	get_condition() {
		return this.filter_edit_area.find('.condition').val();
	}

	set_condition(condition, trigger_change = false) {
		let $condition_field = this.filter_edit_area.find('.condition');
		$condition_field.val(condition);
		if (trigger_change) $condition_field.change();
	}

	add_condition_help(condition) {
		let $desc = this.field.desc_area;
		if (!$desc) {
			$desc = $('<div class="text-muted small">').appendTo(this.field.wrapper);
		}
		// set description
		$desc.html(
			(in_list(['in', 'not in'], condition) === 'in'
				? __('values separated by commas')
				: __('use % as wildcard')) + '</div>'
		);
	}

	hide_invalid_conditions(fieldtype, original_type) {
		let invalid_conditions =
			this.invalid_condition_map[original_type] ||
			this.invalid_condition_map[fieldtype] ||
			[];

		for (let condition of this.conditions) {
			this.filter_edit_area
				.find(`.condition option[value="${condition[0]}"]`)
				.toggle(!invalid_conditions.includes(condition[0]));
		}
	}

	toggle_nested_set_conditions(df) {
		let show_condition =
			df.fieldtype === 'Link' &&
			frappe.boot.nested_set_doctypes.includes(df.options);
		this.nested_set_conditions.forEach((condition) => {
			this.filter_edit_area
				.find(`.condition option[value="${condition[0]}"]`)
				.toggle(show_condition);
		});
	}
};

frappe.ui.filter_utils = {
	get_formatted_value(field, value) {
		if (field.df.fieldname === 'docstatus') {
			value = { 0: 'Draft', 1: 'Submitted', 2: 'Cancelled' }[value] || value;
		} else if (field.df.original_type === 'Check') {
			value = { 0: 'No', 1: 'Yes' }[cint(value)];
		}
		return frappe.format(value, field.df, { only_value: 1 });
	},

	get_selected_value(field, condition) {
		let val = field.get_value();

		if (typeof val === 'string') {
			val = strip(val);
		}

		if (condition == 'is' && !val) {
			val = field.df.options[0].value;
		}

		if (field.df.original_type == 'Check') {
			val = val == 'Yes' ? 1 : 0;
		}

		if (condition.indexOf('like', 'not like') !== -1) {
			// automatically append wildcards
			if (val && !(val.startsWith('%') || val.endsWith('%'))) {
				val = '%' + val + '%';
			}
		} else if (in_list(['in', 'not in'], condition)) {
			if (val) {
				val = val.split(',').map((v) => strip(v));
			}
		}
		if (val === '%') {
			val = '';
		}

		return val;
	},

	get_default_condition(df) {
		if (df.fieldtype == 'Data') {
			return 'like';
		} else if (df.fieldtype == 'Date' || df.fieldtype == 'Datetime') {
			return 'Between';
		} else {
			return '=';
		}
	},

	set_fieldtype(df, fieldtype, condition) {
		// reset
		if (df.original_type) df.fieldtype = df.original_type;
		else df.original_type = df.fieldtype;

		df.description = '';
		df.reqd = 0;
		df.ignore_link_validation = true;

		// given
		if (fieldtype) {
			df.fieldtype = fieldtype;
			return;
		}

		// scrub
		if (df.fieldname == 'docstatus') {
			(df.fieldtype = 'Select'),
				(df.options = [
					{ value: 0, label: __('Draft') },
					{ value: 1, label: __('Submitted') },
					{ value: 2, label: __('Cancelled') },
				]);
		} else if (df.fieldtype == 'Check') {
			df.fieldtype = 'Select';
			df.options = 'No\nYes';
		} else if (
			[
				'Text',
				'Small Text',
				'Text Editor',
				'Code',
				'Tag',
				'Comments',
				'Dynamic Link',
				'Read Only',
				'Assign',
			].indexOf(df.fieldtype) != -1
		) {
			df.fieldtype = 'Data';
		} else if (
			df.fieldtype == 'Link' &&
			[
				'=',
				'!=',
				'descendants of',
				'ancestors of',
				'not descendants of',
				'not ancestors of',
			].indexOf(condition) == -1
		) {
			df.fieldtype = 'Data';
		}
		if (
			df.fieldtype === 'Data' &&
			(df.options || '').toLowerCase() === 'email'
		) {
			df.options = null;
		}
		if (
			condition == 'Between' &&
			(df.fieldtype == 'Date' || df.fieldtype == 'Datetime')
		) {
			df.fieldtype = 'DateRange';
		}
		if (
			condition == 'Timespan' &&
			['Date', 'Datetime', 'DateRange', 'Select'].includes(df.fieldtype)
		) {
			df.fieldtype = 'Select';
			df.options = this.get_timespan_options(['Last', 'Today', 'This', 'Next']);
		}
		if (condition === 'is') {
			df.fieldtype = 'Select';
			df.options = [
				{ label: __('Set'), value: 'set' },
				{ label: __('Not Set'), value: 'not set' },
			];
		}
		return;
	},

	get_timespan_options(periods) {
		const period_map = {
			Last: ['Week', 'Month', 'Quarter', '6 months', 'Year'],
			Today: null,
			This: ['Week', 'Month', 'Quarter', 'Year'],
			Next: ['Week', 'Month', 'Quarter', '6 months', 'Year'],
		};
		let options = [];
		periods.forEach((period) => {
			if (period_map[period]) {
				period_map[period].forEach((p) => {
					options.push({
						label: __(`{0} {1}`, [period, p]),
						value: `${period.toLowerCase()} ${p.toLowerCase()}`,
					});
				});
			} else {
				options.push({
					label: __(`{0}`, [period]),
					value: `${period.toLowerCase()}`,
				});
			}
		});
		return options;
	},
};
