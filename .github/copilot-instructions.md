<Goals>
- We want to create a modular and configurable modulation and demodulation software.
- This software will be mostly used for transmitting data over audio waves.
- It's main focus is on the Frequency modulation scheme which provides
a compromise between.
</Goals>

<Limitations>
- Use no other models other than the Claude Sonnet 4.5 model. For all tasks.
- Write all comments in a consice non-fancy, way and in Slovak language without diacritics.
- Use the same consistent style as the existing codebase, details of thís style
can be found in the .clang-format file in the root of the repo.
- If there are existing comments in Slovak language, do not touch them. Only if they are with
  diacritics, change them to be without diacritics.
- Do not use any emojis at ALL. Neither in the comments or the code itself.
</Limitations>

<WhatToAdd>
Add the following high level details about the codebase to reduce the amount of searching the agent has to do to understand the codebase each time:
<HighLevelDetails>
C99 library written in a modular and configurable way, which uses an extensively flexible FSK
modulation scheme for modulating and demodulating dtaa for the use in acoustic channels.

The main modulation code is in gfsk.c.
</HighLevelDetails>

Add information about how to build and validate changes so the agent does not need to search and find it each time.
<BuildInstructions>

- For each of bootstrap, build, test, run, lint, and any other scripted step, document the sequence of steps to take to run it successfully as well as the versions of any runtime or build tools used.
- Each command should be validated by running it to ensure that it works correctly as well as any preconditions and postconditions.
- Try cleaning the repo and environment and running commands in different orders and document errors and misbehavior observed as well as any steps used to mitigate the problem.
- Run the tests and document the order of steps required to run the tests.
- Make a change to the codebase. Document any unexpected build issues as well as the workarounds.
- Document environment setup steps that seem optional but that you have validated are actually required.
- Document the time required for commands that failed due to timing out.
- When you find a sequence of commands that work for a particular purpose, document them in detail.
- Use language to indicate when something should always be done. For example: "always run npm install before building".
- Record any validation steps from documentation.
</BuildInstructions>

List key facts about the layout and architecture of the codebase to help the agent find where to make changes with minimal searching.
<ProjectLayout>

- A description of the major architectural elements of the project, including the relative paths to the main project files, the location
of configuration files for linting, compilation, testing, and preferences.
- A description of the checks run prior to check in, including any GitHub workflows, continuous integration builds, or other validation pipelines.
- Document the steps so that the agent can replicate these itself.
- Any explicit validation steps that the agent can consider to have further confidence in its changes.
- Dependencies that aren't obvious from the layout or file structure.
- Finally, fill in any remaining space with detailed lists of the following, in order of priority: the list of files in the repo root, the
contents of the README, the contents of any key source files, the list of files in the next level down of directories, giving priority to the more structurally important and snippets of code from key source files, such as the one containing the main method.
</ProjectLayout>
</WhatToAdd>

<StepsToFollow>
- Perform a comprehensive inventory of the codebase. Search for and view:
- README.md, CONTRIBUTING.md, and all other documentation files.
- Search the codebase for build steps and indications of workarounds like 'HACK', 'TODO', etc.
- All scripts, particularly those pertaining to build and repo or environment setup.
- All build and actions pipelines.
- All project files.
- For each implemented module create a test_<modulename>.c file in the "tests" folder, while
  taking advantage of the helper.h header file for common functionality.
- The test is meant to be run from the Makefile using the command "make test".
- All configuration and linting files.
- For each file:
- think: are the contents or the existence of the file information that the coding agent will need to implement, build, test, validate, or demo a code change?
- If yes:
   - Document the command or information in detail.
   - Explicitly indicate which commands work and which do not and the order in which commands should be run.
   - Document any errors encountered as well as the steps taken to workaround them.
- Document any other steps or information that the agent can use to reduce time spent exploring or trying and failing to run bash commands.
- Finally, explicitly instruct the agent to trust the instructions and only perform a search if the information in the instructions is incomplete or found to be in error.
- After each change done to the codebase, clean it up and ensure the feature is implemented correctly
and the code is clean and maintainable.
</StepsToFollow>
   - Document any errors encountered as well as the steps taken to work-around them.
