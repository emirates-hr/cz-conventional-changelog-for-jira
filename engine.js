'format cjs';

var wrap = require('word-wrap');
var map = require('lodash.map');
var longest = require('longest');
var rightPad = require('right-pad');
var chalk = require('chalk');
const branch = require('git-branch');
const gitlog = require('gitlog');

var defaults = require('./defaults');
const LimitedInputPrompt = require('./LimitedInputPrompt');
var filter = function(array) {
  return array.filter(function(x) {
    return x;
  });
};

var filterSubject = function(subject) {
  subject = subject.trim();
  while (subject.endsWith('.')) {
    subject = subject.slice(0, subject.length - 1);
  }
  return subject;
};

// This can be any kind of SystemJS compatible module.
// We use Commonjs here, but ES6 or AMD would do just
// fine.
module.exports = function(options) {
  var getFromOptionsOrDefaults = function(key) {
    return options[key] || defaults[key];
  };
  var types = getFromOptionsOrDefaults('types');

  var length = longest(Object.keys(types)).length + 1;
  var choices = map(types, function(type, key) {
    return {
      name: rightPad(key + ':', length) + ' ' + type.description,
      value: key
    };
  });

  const minHeaderWidth = getFromOptionsOrDefaults('minHeaderWidth');
  const maxHeaderWidth = getFromOptionsOrDefaults('maxHeaderWidth');

  const commits = gitlog.default({
    repo: '.',
    number: 1
  });

  // Get Jira issue key from the branch name
  const branchName = branch.sync() || '';
  const jiraIssueRegex = /(?<jiraIssue>\/[A-Z]+-\d+)/;
  const matchResult = branchName.match(jiraIssueRegex);

  // Get Jira issue key from the previous commit subject
  const lastSubject = commits.length > 0 ? commits[0].subject  : '';
  const jiraSubjectIssueRegex = /(?<jiraIssue>\[[A-Z]+-\d+\])/;
  const commitMatchResult = lastSubject.match(jiraSubjectIssueRegex);

  let jiraIssue = '';

  if (matchResult && matchResult.groups && matchResult.groups.jiraIssue) {
    jiraIssue = matchResult.groups.jiraIssue.substring(1);
  }

  if (commitMatchResult && commitMatchResult.groups && commitMatchResult.groups.jiraIssue) {
    jiraIssue = commitMatchResult.groups.jiraIssue;
  }

  const hasScopes =
    options.scopes &&
    Array.isArray(options.scopes) &&
    options.scopes.length > 0;
  const scopeOverrides = options.scopeOverrides || {};

  return {
    // When a user runs `git cz`, prompter will
    // be executed. We pass you cz, which currently
    // is just an instance of inquirer.js. Using
    // this you can ask questions and get answers.
    //
    // The commit callback should be executed when
    // you're ready to send back a commit template
    // to git.
    //
    // By default, we'll de-indent your commit
    // template and will keep empty lines.
    prompter: function(cz, commit) {
      cz.registerPrompt('limitedInput', LimitedInputPrompt);

      // Let's ask some questions of the user
      // so that we can populate our commit
      // template.
      //
      // See inquirer.js docs for specifics.
      // You can also opt to use another input
      // collection library if you prefer.
      cz.prompt([
        {
          type: 'list',
          name: 'type',
          message: "Select the type of change that you're committing:",
          choices: choices,
          default: options.defaultType
        },
        {
          type: hasScopes ? 'list' : 'input',
          name: 'scope',
          when: !options.skipScope,
          choices: function(answers) {
            let scopes = [];

            if (hasScopes) {
              scopes = options.scopes;
            }

            if (scopeOverrides[answers.type]) {
              scopes = scopeOverrides[answers.type];
            }

            if (options.allowCustomScopes || scopes.length === 0) {
              scopes = scopes.concat([
                new cz.Separator(),
                { name: 'empty', value: false },
                { name: 'custom', value: 'custom' },
              ]);
            }

            return scopes;
          },
          message: 'What is the scope of this change (e.g. component or file name):',
          default: options.defaultScope,
          filter: function(value) {
            return value.trim().toLowerCase();
          }
        },
        {
          type: 'input',
          name: 'scope',
          message: 'What is the scope of this change:',
          when(answers) {
            return answers.scope === 'custom';
          },
        },
        {
          type: 'input',
          name: 'jira',
          message:
            'Enter JIRA issue (' +
            getFromOptionsOrDefaults('jiraPrefix') +
            '-12345):',
          when: options.jiraMode,
          default: jiraIssue,
          validate: function(jira) {
            return /^[A-Z]+-[0-9]+$/.test(jira);
          },
          filter: function(jira) {
            return jira.toUpperCase();
          }
        },
        {
          type: 'limitedInput',
          name: 'subject',
          message: 'Write a short, imperative tense description of the change:',
          default: options.defaultSubject,
          maxLength: maxHeaderWidth,
          leadingLabel: answers => {
            const jira = answers.jira ? ` [${answers.jira}]` : '';
            let scope = '';

            if (answers.scope && answers.scope !== 'none') {
              scope = `(${answers.scope})`;
            }

            return `${answers.type}${scope}:${jira}`;
          },
          validate: input =>
            input.length >= minHeaderWidth ||
            `The subject must have at least ${minHeaderWidth} characters`,
          filter: function(subject) {
            return filterSubject(subject);
          }
        },
        {
          type: 'input',
          name: 'body',
          message:
            'Provide a longer description of the change: (press enter to skip)\n',
          default: options.defaultBody
        },
        {
          type: 'confirm',
          name: 'isBreaking',
          message: 'Are there any breaking changes?',
          default: false
        },
        {
          type: 'input',
          name: 'breaking',
          message: 'Describe the breaking changes:\n',
          when: function(answers) {
            return answers.isBreaking;
          }
        },

        {
          type: 'confirm',
          name: 'isIssueAffected',
          message: 'Does this change affect any open issues?',
          default: options.defaultIssues ? true : false,
          when: !options.jiraMode
        },
        {
          type: 'input',
          name: 'issuesBody',
          default: '-',
          message:
            'If issues are closed, the commit requires a body. Please enter a longer description of the commit itself:\n',
          when: function(answers) {
            return (
              answers.isIssueAffected && !answers.body && !answers.breakingBody
            );
          }
        },
        {
          type: 'input',
          name: 'issues',
          message: 'Add issue references (e.g. "fix #123", "re #123".):\n',
          when: function(answers) {
            return answers.isIssueAffected;
          },
          default: options.defaultIssues ? options.defaultIssues : undefined
        },
        {
          type: 'input',
          name: 'jiraComment',
          message: 'Add a comment for Jira: (press enter to skip)\n',
          default: undefined
        },
        {
          type: 'input',
          name: 'trackTime',
          message: 'Enter the time if you want to track it in Jira (format: 1w 2d 4h 30m):  (press enter to skip)\n',
          validate: input => /^(\dw)?\s?(\dd)?\s?(\d{1,2}h)?\s?(\d{1,2}m)?$/.test(input),
          default: undefined
        }
      ]).then(function(answers) {
        var wrapOptions = {
          trim: true,
          cut: false,
          newline: '\n',
          indent: '',
          width: options.maxLineWidth
        };

        // parentheses are only needed when a scope is present
        const scope = answers.scope ? `(${answers.scope})` : '';
        const jira = answers.jira ? `[${answers.jira}] ` : '';

        // Hard limit this line in the validate
        const head = answers.type + scope + ': ' + jira + answers.subject;

        // Wrap these lines at options.maxLineWidth characters
        const body = answers.body ? wrap(answers.body, wrapOptions) : false;

        // Apply breaking change prefix, removing it if already present
        let breaking = answers.breaking ? answers.breaking.trim() : '';
        breaking = breaking
          ? 'BREAKING CHANGE: ' + breaking.replace(/^BREAKING CHANGE: /, '')
          : '';
        breaking = breaking ? wrap(breaking, wrapOptions) : false;

        const issues = answers.issues ? wrap(answers.issues, wrapOptions) : false;

        const jiraComment = answers.jiraComment ? `#comment ${answers.jiraComment}` : false;
        const time = answers.trackTime ? `#time ${answers.trackTime}` : false;

        commit(filter([head, body, breaking, issues, jiraComment, time]).join('\n\n'));
      });
    }
  };
};
