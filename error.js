/* Copyright (c) 2015, Oracle and/or its affiliates. All rights reserved. */

/******************************************************************************
 *
 * You may not use the identified files except in compliance with the Apache
 * License, Version 2.0 (the "License.")
 *
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0.
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * NAME
 *   error.js
 *
 * DESCRIPTION
 *   Basic error management module.
 *
 *****************************************************************************/

function send400(res) {
    res.writeHead(400, {'Content-Type' : 'text/html' });

    res.end('Client error.');
}

function send404(res) {
    res.writeHead(404, {'Content-Type' : 'text/html' });

    res.end('Page not found.');
}

function send500(res) {
    res.writeHead(500, {'Content-Type' : 'text/html' });

    res.end('Error');
}

exports.send400 = send400;
exports.send404 = send404;
exports.send500 = send500;
