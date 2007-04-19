/*
  Copyright (C) 2005-2006 by Massimiliano Mirra

  This program is free software; you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation; either version 2 of the License, or
  (at your option) any later version.

  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU General Public License for more details.

  You should have received a copy of the GNU General Public License
  along with this program; if not, write to the Free Software
  Foundation, Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301 USA

  Author: Massimiliano Mirra, <bard [at] hyperstruct [dot] net>
*/


/**
 * Routines for generic text manipulation.
 *
 */


// GLOBAL DEFINITIONS
// ----------------------------------------------------------------------

var text = {};


// UTILITIES
// ----------------------------------------------------------------------

/**
 * For each match of regexp in string, executes processFn.  Returns an
 * array of unprocessed string parts plus processed string parts.
 *
 */
    
text.mapMatch = function(string, regexp, processFn) {
    if(!regexp.global)
        throw new Error('RegExp must be global. (' + regexp.source + ')');

    var parts = [];
    var start = 0;

    var match = regexp.exec(string);
    while(match) {
        parts.push(string.substring(start, match.index));

        start = regexp.lastIndex;

        parts.push(processFn(match));

        match = regexp.exec(string);
    }
    parts.push(string.substring(start, string.length));

    return parts;
};
