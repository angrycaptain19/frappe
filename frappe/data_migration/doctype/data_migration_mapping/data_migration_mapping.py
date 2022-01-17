# -*- coding: utf-8 -*-
# Copyright (c) 2017, Frappe Technologies and contributors
# License: MIT. See LICENSE

import frappe
from frappe.model.document import Document
from frappe.utils.safe_exec import get_safe_globals

class DataMigrationMapping(Document):
	def get_filters(self):
		if self.condition:
			return frappe.safe_eval(self.condition, get_safe_globals())

	def get_fields(self):
		fields = [
		    f.local_fieldname for f in self.fields
		    if not (f.local_fieldname[0] in
		            ('"', "'") or f.local_fieldname.startswith('eval:'))
		]
		if frappe.db.has_column(self.local_doctype, self.migration_id_field):
			fields.append(self.migration_id_field)

		if 'name' not in fields:
			fields.append('name')

		return fields

	def get_mapped_record(self, doc):
		'''Build a mapped record using information from the fields table'''
		mapped = frappe._dict()

		key_fieldname = 'remote_fieldname'
		value_fieldname = 'local_fieldname'

		if self.mapping_type == 'Pull':
			key_fieldname, value_fieldname = value_fieldname, key_fieldname

		for field_map in self.fields:
			key = get_source_value(field_map, key_fieldname)

			if not field_map.is_child_table:
				# field to field mapping
				value = get_value_from_fieldname(field_map, value_fieldname, doc)
			else:
				# child table mapping
				mapping_name = field_map.child_table_mapping
				value = get_mapped_child_records(mapping_name,
					doc.get(get_source_value(field_map, value_fieldname)))

			mapped[key] = value

		return mapped

def get_mapped_child_records(mapping_name, child_docs):
	mapping = frappe.get_doc('Data Migration Mapping', mapping_name)
	return [mapping.get_mapped_record(child_doc) for child_doc in child_docs]

def get_value_from_fieldname(field_map, fieldname_field, doc):
	field_name = get_source_value(field_map, fieldname_field)

	if field_name.startswith('eval:'):
		return frappe.safe_eval(field_name[5:], get_safe_globals())
	elif field_name[0] in ('"', "'"):
		return field_name[1:-1]
	else:
		return get_source_value(doc, field_name)

def get_source_value(source, key):
	'''Get value from source (object or dict) based on key'''
	return source.get(key) if isinstance(source, dict) else getattr(source, key)
