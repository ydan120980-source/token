'use strict';
// Shared limits; resource parsers do not import the HTTP paginator.
const PAGE_SIZE = 100, MAX_PAGES = 10, MAX_PACKAGES = PAGE_SIZE * MAX_PAGES, MAX_BYTES = 2 * 1024 * 1024;
module.exports = { PAGE_SIZE, MAX_PAGES, MAX_PACKAGES, MAX_BYTES };
