"use strict";
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
Object.defineProperty(exports, "__esModule", { value: true });
exports.fixDummyValueString = exports.loadSSMParams = void 0;
const configParams = require('../../config.params.json');
const ssm = require("aws-cdk-lib/aws-ssm");
const loadSSMParams = (scope) => {
    const params = {};
    const SSM_NOT_DEFINED = 'not-defined';
    for (const param of configParams.parameters) {
        if (param.boolean) {
            params[param.name] = (ssm.StringParameter.valueFromLookup(scope, `${configParams.hierarchy}${param.name}`).toLowerCase() === "true");
        }
        else {
            params[param.name] = ssm.StringParameter.valueFromLookup(scope, `${configParams.hierarchy}${param.name}`);
        }
    }
    return { ...params, SSM_NOT_DEFINED };
};
exports.loadSSMParams = loadSSMParams;
const fixDummyValueString = (value) => {
    if (value.includes('dummy-value-for-'))
        return value.replace(/\//g, '-').replace('dummy-value-for-', '');
    else
        return value;
};
exports.fixDummyValueString = fixDummyValueString;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3NtLXBhcmFtcy11dGlsLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsic3NtLXBhcmFtcy11dGlsLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQSxxRUFBcUU7QUFDckUsaUNBQWlDOzs7QUFHakMsTUFBTSxZQUFZLEdBQUcsT0FBTyxDQUFDLDBCQUEwQixDQUFDLENBQUE7QUFDeEQsMkNBQTBDO0FBRW5DLE1BQU0sYUFBYSxHQUFHLENBQUMsS0FBZ0IsRUFBRSxFQUFFO0lBQ2hELE1BQU0sTUFBTSxHQUFRLEVBQUUsQ0FBQTtJQUN0QixNQUFNLGVBQWUsR0FBRyxhQUFhLENBQUM7SUFDdEMsS0FBSyxNQUFNLEtBQUssSUFBSSxZQUFZLENBQUMsVUFBVSxFQUFFO1FBQzNDLElBQUksS0FBSyxDQUFDLE9BQU8sRUFBRTtZQUNqQixNQUFNLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLGVBQWUsQ0FBQyxlQUFlLENBQUMsS0FBSyxFQUFFLEdBQUcsWUFBWSxDQUFDLFNBQVMsR0FBRyxLQUFLLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQyxXQUFXLEVBQUUsS0FBSyxNQUFNLENBQUMsQ0FBQztTQUN0STthQUNJO1lBQ0gsTUFBTSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsR0FBRyxHQUFHLENBQUMsZUFBZSxDQUFDLGVBQWUsQ0FBQyxLQUFLLEVBQUUsR0FBRyxZQUFZLENBQUMsU0FBUyxHQUFHLEtBQUssQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDO1NBQzNHO0tBQ0Y7SUFDRCxPQUFPLEVBQUUsR0FBRyxNQUFNLEVBQUUsZUFBZSxFQUFFLENBQUE7QUFDdkMsQ0FBQyxDQUFBO0FBWlksUUFBQSxhQUFhLGlCQVl6QjtBQUVNLE1BQU0sbUJBQW1CLEdBQUcsQ0FBQyxLQUFhLEVBQVUsRUFBRTtJQUMzRCxJQUFJLEtBQUssQ0FBQyxRQUFRLENBQUMsa0JBQWtCLENBQUM7UUFBRSxPQUFPLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxFQUFFLEdBQUcsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxrQkFBa0IsRUFBQyxFQUFFLENBQUMsQ0FBQzs7UUFDbkcsT0FBTyxLQUFLLENBQUM7QUFDcEIsQ0FBQyxDQUFBO0FBSFksUUFBQSxtQkFBbUIsdUJBRy9CIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQ29weXJpZ2h0IEFtYXpvbi5jb20sIEluYy4gb3IgaXRzIGFmZmlsaWF0ZXMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4vLyBTUERYLUxpY2Vuc2UtSWRlbnRpZmllcjogTUlULTBcblxuaW1wb3J0IHtDb25zdHJ1Y3R9IGZyb20gXCJjb25zdHJ1Y3RzXCI7XG5jb25zdCBjb25maWdQYXJhbXMgPSByZXF1aXJlKCcuLi8uLi9jb25maWcucGFyYW1zLmpzb24nKVxuaW1wb3J0ICogYXMgc3NtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zc20nXG5cbmV4cG9ydCBjb25zdCBsb2FkU1NNUGFyYW1zID0gKHNjb3BlOiBDb25zdHJ1Y3QpID0+IHtcbiAgY29uc3QgcGFyYW1zOiBhbnkgPSB7fVxuICBjb25zdCBTU01fTk9UX0RFRklORUQgPSAnbm90LWRlZmluZWQnO1xuICBmb3IgKGNvbnN0IHBhcmFtIG9mIGNvbmZpZ1BhcmFtcy5wYXJhbWV0ZXJzKSB7XG4gICAgaWYgKHBhcmFtLmJvb2xlYW4pIHtcbiAgICAgIHBhcmFtc1twYXJhbS5uYW1lXSA9IChzc20uU3RyaW5nUGFyYW1ldGVyLnZhbHVlRnJvbUxvb2t1cChzY29wZSwgYCR7Y29uZmlnUGFyYW1zLmhpZXJhcmNoeX0ke3BhcmFtLm5hbWV9YCkudG9Mb3dlckNhc2UoKSA9PT0gXCJ0cnVlXCIpO1xuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgIHBhcmFtc1twYXJhbS5uYW1lXSA9IHNzbS5TdHJpbmdQYXJhbWV0ZXIudmFsdWVGcm9tTG9va3VwKHNjb3BlLCBgJHtjb25maWdQYXJhbXMuaGllcmFyY2h5fSR7cGFyYW0ubmFtZX1gKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHsgLi4ucGFyYW1zLCBTU01fTk9UX0RFRklORUQgfVxufVxuXG5leHBvcnQgY29uc3QgZml4RHVtbXlWYWx1ZVN0cmluZyA9ICh2YWx1ZTogc3RyaW5nKTogc3RyaW5nID0+IHtcbiAgaWYgKHZhbHVlLmluY2x1ZGVzKCdkdW1teS12YWx1ZS1mb3ItJykpIHJldHVybiB2YWx1ZS5yZXBsYWNlKC9cXC8vZywgJy0nKS5yZXBsYWNlKCdkdW1teS12YWx1ZS1mb3ItJywnJyk7XG4gIGVsc2UgcmV0dXJuIHZhbHVlO1xufVxuIl19