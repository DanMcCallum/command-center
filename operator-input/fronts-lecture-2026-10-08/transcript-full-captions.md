# Combinatorial Ralph Loops and Proactive Fronts (recording), full captions

Same source as transcript-fronts-section.md; whole recording (0:00 to 1:21:43), caption track text.

[00:00:00] Okay, I'm going to lecture about another thing as well.
[00:00:03] Okay, yeah, I'm going to real quick lecture about this.
[00:00:08] Okay, where are we?
[00:00:11] Where are we?
[00:00:13] Okay, yeah, so here is the problem statement, and here's an example.
[00:00:23] Let's say I have, this is basically combinatorial brow flutes.
[00:00:29] This is, I just coined this term in the last one second, so you're welcome.
[00:00:36] So let's say we have a problem statement.
[00:00:39] Optimized?
[00:00:40] Am I not sure?
[00:00:43] Uh oh, okay, thank you.
[00:00:48] Let me put you guys down here doing monitor setup stuff.
[00:00:54] Okay, here we go.
[00:00:56] Okay, let's talk about combinatorial brow flutes.
[00:00:59] And welcome Daniel, by the way, welcome welcome.
[00:01:03] Uh, okay, so let's say we want to optimize architecture for an existing system,
[00:01:18] period.
[00:01:19] Now everyone knows that you can kind of combine and take away different levers
[00:01:27] in a lot of
[00:01:27] systems, and those each probably take a lot of work and take their own tests.
[00:01:34] So what I wanted to do is build a software factory, so I'll add to the problem
[00:01:41] set statement.
[00:01:43] The idea is to optimize software factory architecture for an existing system,
[00:01:56] and run it on five
[00:01:58] open source repos, period.
[00:02:01] So the idea behind this is that we have a software factory, and basically what
[00:02:10] we do
[00:02:11] is we apply the software factory to five repos.
[00:02:17] And the repos are pedantic, pedantic AI.
[00:02:21] Uh, I think it is Hugo and Vue, I'll just say these four.
[00:02:29] There's another, but I forgot what it is.
[00:02:32] But it's mostly these four we focus on.
[00:02:35] So if I wanted to apply the software factory to four repos on 30 tickets each,
[00:02:44] how did
[00:02:44] I do this without having to sit there and kind of run through it?
[00:02:49] Well the obvious answer is route loops.
[00:02:52] So this is where combinatorial route loops come in.
[00:02:56] So we take a prompt, and the prompt is as follows.
[00:03:05] I have five different software factory architectures.
[00:03:08] So just FYI, these five are like, just as a little example, normal route loop,
[00:03:16] versus
[00:03:17] asking it to spawn subagents, versus a Jev effort tuner, plus spawn subagents,
[00:03:28] versus foreman,
[00:03:31] you know, et cetera.
[00:03:34] So if I have all of these different architectures that I want to try, you know,
[00:03:38] the first thing
[00:03:39] you would do is build each one of these five, right?
[00:03:44] So it's going to say, let's see, let's say we inject that in list, that I want
[00:03:57] to try.
[00:03:58] For each architecture, I have five repos I want to test, 30 tickets each, to
[00:04:05] see how
[00:04:06] the factory performs.
[00:04:08] Spawn a route loop, one iteration, starting with a slash goal, I'll get to this
[00:04:13] , per software
[00:04:14] factory architecture, to build the architecture via dynamic workflow, period.
[00:04:25] So let me break down kind of the idea behind this.
[00:04:30] So first you'll notice there's a slash goal.
[00:04:34] Now the slash goal makes it so that this session really cannot end until
[00:04:41] everything else is
[00:04:43] done below it.
[00:04:45] So this session is then going to spawn five sessions, I'll just do three for
[00:04:51] the purposes
[00:04:52] of this, and ideally the prompts for each one of these sessions will be slash
[00:04:59] goal.
[00:05:00] Build this software factory architecture, architecture, and create a route loop
[00:05:12] , one
[00:05:13] iteration per repo, to oversee the runs on each of these repos.
[00:05:26] Okay, so now, if you can see, we have a slash goal, which is viewing each one
[00:05:40] of these.
[00:05:42] And now, here's where it gets kind of ridiculous, is each one of these is going
[00:05:48] to correspond
[00:05:50] to a repo.
[00:05:51] We'll just say it's three repos, just for ease again.
[00:05:54] And so now the prompt is going to be slash goal.
[00:05:59] I am running my software factory, factory path on, I'm just going to say run.
[00:06:11] Run my software factory on this repo, let's say, if anything breaks, fix it and
[00:06:23] writes
[00:06:24] down the issue in till the slash does.
[00:06:31] Now, as you can see, we have kind of a ridiculous nested architecture.
[00:06:43] And here's, so are you guys kind of tracking thus far?
[00:06:47] I'm going to reveal a little more about why this architecture, but are we
[00:06:50] tracking what
[00:06:51] this architecture is at this time?
[00:06:54] Yes.
[00:06:55] Cool.
[00:06:56] Cool, cool, cool.
[00:06:58] And so just one more, and by the way, you can assume it would be the same thing
[00:07:03] for each
[00:07:03] one of these.
[00:07:04] I just don't want to make it super messy.
[00:07:06] Maybe I'll make these really small just to make it.
[00:07:10] Oops.
[00:07:11] Yeah, I'll just make these really small, so that we don't get overlapped, but
[00:07:15] you'll
[00:07:16] see like it's the same idea.
[00:07:19] Okay.
[00:07:21] So now, the software factory is kind of a route loop in its own right, which is
[00:07:31] like
[00:07:31] all tickets number one, and then it's going to say, so all tickets number two.
[00:07:42] And I'll just say, verify ticket number one, and then it's gates.
[00:08:00] And then if those gates pass, self ticket number two, right?
[00:08:04] So this is what a software factory kind of is at a high level.
[00:08:10] And the crazy thing is that if I run this, you can either have it run in
[00:08:16] sequence or parallel,
[00:08:18] because these are isolated instances.
[00:08:21] But I mean, this will just run this architecture.
[00:08:25] So let's say that each ticket takes, let's say each ticket takes five minutes.
[00:08:36] Times 30 tickets, times five repos, times five architecture things.
[00:08:47] So this is going to be 125 times 30, which is 3,750 minutes divided by so 62
[00:09:01] hours.
[00:09:02] So this is an example of, I kid you not one prompt.
[00:09:07] This would take you 30 seconds to create, just like making that very clear.
[00:09:13] This would take you 30 seconds to create for 62 hours of output.
[00:09:20] So when I say like embrace the exponential, this is the type of shit I'm
[00:09:23] talking about.
[00:09:24] And Daniel asks, when you say running a software factory on these repos, do you
[00:09:28] mean that we
[00:09:29] are recreating those repos locally?
[00:09:32] So Daniel, basically the idea is that we take these repos, we take issues on
[00:09:40] the repo,
[00:09:42] like issues that people have posted, and then we run our software factory one
[00:09:46] iteration
[00:09:47] per issue to solve it.
[00:09:51] So basically, I don't mean it's like a clean rooming recreating it, but we're
[00:09:56] just like
[00:09:57] fixing those issues.
[00:09:58] And the reason I'm doing this is to prove that it outperforms humans, which if
[00:10:02] anyone
[00:10:03] hasn't heard me talk about this, we saw our repo outperforms by about nine on
[00:10:09] about nine
[00:10:10] out of 10 tickets compared to a human solver.
[00:10:15] Okay, so, so, so, so, so, what was I going to say?
[00:10:23] Oh yeah, here's the big thing.
[00:10:27] The reason we do slash goal, and let me make this green, the real reason we do
[00:10:32] slash goal
[00:10:34] is so that we can do not stop until completion, criteria is hit, right, very
[00:10:45] simply.
[00:10:46] But if we ask this session, do not stop until all factories, all factory
[00:11:01] architectures,
[00:11:04] manage their work, this session will be open for 62 hours.
[00:11:10] And by the way, I think there's like some weird issues related to a clock
[00:11:16] closing down
[00:11:17] slash goals that run for too long.
[00:11:19] Like I've seen there's something like that.
[00:11:21] You can look in the documentation.
[00:11:23] There's ways to fix it.
[00:11:24] You just do hooks and you nudge.
[00:11:28] But think about like the context burden.
[00:11:30] So if I say monitor, oh, it's actually monitors.
[00:11:35] If you have something monitoring and it's too long between monitoring, the
[00:11:41] monitor stops.
[00:11:44] Just FYI.
[00:11:45] So monitor each one of these iterations of your loop.
[00:11:52] So it alerts you when it finishes, so you can fix if something went wrong.
[00:12:07] I think I also had oh, and also something really cool is also allow the
[00:12:19] iterations to
[00:12:20] ask new questions during the road.
[00:12:25] If a question is asked on parallel subagents to look for the answer in my
[00:12:39] computer, if
[00:12:41] there is not a clear answer, text me on my phone.
[00:12:49] So this is the idea.
[00:12:56] And basically, this will run for 62 hours, but think about the context burden
[00:13:01] behind this.
[00:13:02] So 62 hours, let's say it's just around 12, let's say it's 12 hours per
[00:13:09] iteration of the
[00:13:10] key route loop, so 12 hours between monitor finishing.
[00:13:19] So by monitor finishing, I mean this one finished and let this guy know.
[00:13:25] That is about like one k tokens of context burden every 12 hours.
[00:13:33] And let's say it's a little longer because of questions or whatever.
[00:13:37] Let's say it's 10 k tokens of context burden every 12 hours.
[00:13:41] And yes, FYI, this is not very cash efficient, but since you're keeping all of
[00:13:46] your sessions
[00:13:47] low, it doesn't really matter.
[00:13:51] So think about it this way.
[00:13:53] You let this run and it's 12 hours and it pings 10k more tokens.
[00:14:01] So you come back after 62 hours to this session and it's only at like 40k
[00:14:08] tokens.
[00:14:09] And so the same pattern applies to this one and the same pattern applies to
[00:14:16] this one.
[00:14:18] So you're basically getting a free, I call these like overseer agents, their
[00:14:23] whole purpose
[00:14:24] is not to actually do any work, but they're building the route loop and then
[00:14:28] they're just
[00:14:29] going to sit there and monitor it because I'm sure any one of you who've built
[00:14:33] autonomous
[00:14:34] route loops have kind of noticed sometimes like something breaks and then it
[00:14:38] just gets
[00:14:38] stuck.
[00:14:39] And you come back the next morning and it's like, this route flew actually
[00:14:43] broke and did
[00:14:44] nothing all night.
[00:14:46] And then you're like, what the hell?
[00:14:48] So that's kind of the point behind the overseers.
[00:14:51] And then you can see a little addition here with the question answering.
[00:14:57] You can basically get it so that it's asynchronously waiting for you or tri
[00:15:05] aging answers itself.
[00:15:06] And so your leverage on a prompt like this, like sitting down and spending the
[00:15:11] time to
[00:15:11] manually write a prompt like this is hundreds of hours of leverage for 30
[00:15:17] seconds of work.
[00:15:19] Make sense?
[00:15:20] Questions on how this would apply to your situations?
[00:15:23] So, questions of this first or for each software factory architecture, you
[00:15:37] would then zone
[00:15:39] again a route loop to go through the tickets or?
[00:15:46] Yes.
[00:15:47] Yes, exactly.
[00:15:49] So for each architecture of the five, so this is like, I mean, basically, it's
[00:15:56] a nested for
[00:15:57] loop, right?
[00:16:02] So I'll say arc in architectures.
[00:16:07] And then it's for ticket in tickets and then it's for, where are we?
[00:16:20] For, actually, for repo and redirects.
[00:16:30] So, obviously, the prompt would be dynamic based on which iteration you're at.
[00:16:44] So, the biggest question for me is how we would actually compare the result
[00:16:56] like if the
[00:16:57] result from this architecture or from this ticket implementation is better than
[00:17:04] from
[00:17:04] other one, like one is like token cost, speed or time, how much it would take,
[00:17:13] others would
[00:17:14] be like how to measure the quality of the finished task.
[00:17:20] Yeah, it's a good question.
[00:17:22] So basically, in our case, and if you're ever running this, first of all, there
[00:17:28] 's like decent
[00:17:29] observability alone in the fact that these sessions exist on your computer, so
[00:17:34] you can
[00:17:35] reverse search.
[00:17:36] But in our software factory, specifically, it, you know, for example, writes
[00:17:42] down issues
[00:17:42] and notes, but it also will record the win rate of the tickets.
[00:17:48] So you get a write up of each ticket, and then it's just saving that on disk,
[00:17:54] right?
[00:17:55] So that's how you get those results is instead of holding it in context, you
[00:17:59] save it as an
[00:18:00] artifact on disk.
[00:18:02] And so you have to ask Claude to make those or have the last iteration of your
[00:18:06] factory
[00:18:07] kind of give you an overview.
[00:18:08] And then, you know, back here, you get to just like start a new session and
[00:18:20] look at the overviews.
[00:18:24] So this is like unbelievably good for evals is like the obvious use case.
[00:18:32] Anyone who knows research would know the term ablation testing, which is
[00:18:36] basically where
[00:18:36] you take out one component of your system and see how it affects performance.
[00:18:41] It's also extremely good for, you know, testing out pretty much anything, like
[00:18:49] copywriting.
[00:18:50] You could have it write Reddit posts and then change how the Reddit posts is
[00:18:54] being written
[00:18:55] and then eval the Reddit posts, somebody typed what he's just doing.
[00:19:01] Well, it's a good way to compare code quality between the different
[00:19:05] architectures.
[00:19:05] In the case, they all fix a given ticket.
[00:19:08] Yeah, I mean, Daniel, I think like proxy metrics are typically pretty good.
[00:19:15] A lot of cases just by the way is like, maybe this is a little controversial to
[00:19:23] say, but
[00:19:24] if it actually did fix the given ticket, I don't care too, too much anymore how
[00:19:31] , right?
[00:19:32] As long as it didn't break something else, as long as it didn't insert a ton of
[00:19:36] slop,
[00:19:36] like, but generally models nowadays don't do that unless if you hobble them to
[00:19:41] do that.
[00:19:42] And then you just have some like high level checks, like a cyclomatic
[00:19:47] complexity check.
[00:19:48] That's like one example of a way to compare code quality.
[00:19:54] But generally, just like, I think LLM is a judge is what we used.
[00:19:59] We basically shuffled the R fix versus the human fix.
[00:20:05] And we basically said we had some judging criteria, but we said, you know, are
[00:20:10] the which one
[00:20:10] is better or are they the same quality.
[00:20:15] And with the current models, like Opus 5.5, which is like super cool, is
[00:20:25] running implementation
[00:20:28] and then in separate session or Atlas agent, running verify and test good
[00:20:33] enough.
[00:20:35] Like if it has access to, I don't know, environment and running end to end test
[00:20:40] , is it enough?
[00:20:43] You mentioned before that the test driven development is not the right way or
[00:20:50] for what
[00:20:51] I researched, it looks like it cannot work if the agent is writing the test in
[00:21:01] advance.
[00:21:01] But it might be good way if still humans writing them and verify them, which is
[00:21:06] bullshit.
[00:21:07] So and this probably not the way.
[00:21:15] So like if we know, you know, the original RPIV, right, research, plan,
[00:21:23] implement, verify,
[00:21:25] I want to make my stance relatively clear on like where we should be spending
[00:21:33] our time
[00:21:33] and which one of these steps are still useful and there's a bunch of acronyms
[00:21:38] for this.
[00:21:38] But like, I think this should answer your question.
[00:21:42] My favorite, favorite thing for difficult or uncertain tasks is research.
[00:21:51] So this is like Ralph Loops, dynamic workflows, this, this pattern.
[00:22:01] So on the tutorial, Ralph Loops, et cetera, right?
[00:22:07] So I love researching kind of fixes, running e-vals, running benchmarks,
[00:22:13] testing, et cetera.
[00:22:15] Plan?
[00:22:17] Now I know some of you love plan, you love spectrum and development.
[00:22:22] It's not not necessary anymore.
[00:22:24] Like this is the main thing that really changed is planning is just not, I don
[00:22:31] 't think it's
[00:22:32] necessary anymore.
[00:22:34] I think there is value towards bidirectional prompting still.
[00:22:39] But for the most part, like I don't bidirectional prompt and then create a spec
[00:22:42] and then implement
[00:22:43] the spec.
[00:22:44] I just, it's really necessary.
[00:22:48] For me, planning is only to like design how to parallelize because a cable
[00:22:55] wants to run
[00:22:57] it all in one session, right?
[00:23:00] So planning for me is only to tell it, okay, just use the dynamic workflows or
[00:23:07] use the
[00:23:08] Ralph or use the parallel subation, something like this.
[00:23:14] Yeah.
[00:23:15] I think like, I mean, I don't plan that out.
[00:23:19] For me personally, I just know like typically if it's long horizon or it's more
[00:23:24] exploratory.
[00:23:26] And for me, I use codecs.
[00:23:27] So I like Ralph loops with codecs because codecs doesn't have dynamic workflows
[00:23:31] .
[00:23:31] A lot of times I'll just say Ralph loops for kind of long running higher explor
[00:23:37] atory tasks.
[00:23:39] For well-defined tasks, I pick dynamic workflows, software factory, like I just
[00:23:46] haven't had
[00:23:47] the need to use a software factory for like, I will suit, but I think tasks are
[00:23:55] so in the
[00:23:56] software factory are so insane that I haven't needed that.
[00:24:01] And then direct execution, I go for a lot.
[00:24:03] Like I'll just start a session and just be like, you know, do it, do it in the
[00:24:08] loop with
[00:24:08] me and I'll read the trace, use slash BTW, use slash rewind, so yeah.
[00:24:17] But I think research valuable plan, no longer really valuable, you're just
[00:24:23] causing.
[00:24:25] So like if anyone's heard of, I think I mentioned this, if anyone's heard of
[00:24:29] the telephone kids
[00:24:30] game, it's basically where you have like somebody says, see cucumber.
[00:24:39] And then they have to whisper to the person to the right the word see cucumber.
[00:24:46] And then let's say the person to the right misheard them and they thought they
[00:24:50] said
[00:24:50] see crest, and then this person thought that they said, like crust, I don't
[00:24:58] know, like
[00:24:59] seek crust, I don't know.
[00:25:02] And then this person, I don't know, it doesn't matter, but let's say it's a
[00:25:07] three person
[00:25:07] telephone, you go from seek cucumber all the way to see crust.
[00:25:12] So the more context windows that you try to compress the context window into a
[00:25:18] plan,
[00:25:18] the more the more chains of telephone you're adding.
[00:25:23] And so back in the day, it was kind of necessary like create a specification
[00:25:28] because the agent
[00:25:29] needs to know like kind of exactly how to do stuff.
[00:25:33] And my advice back then was like read the read the specification so that you
[00:25:37] don't see
[00:25:37] information loss.
[00:25:39] But now it's pretty much the agents are good enough such that you clarify what
[00:25:44] you want
[00:25:46] and then you execute in a different context window with the planner as kind of
[00:25:50] an orchestrator.
[00:25:52] So like if you're bidirectional prompting, you're talking about it, you're
[00:25:55] using rewind,
[00:25:56] you're keeping it very condensed.
[00:25:58] And then you say spawn a dynamic workflow, like I like to do slash goal, spawn
[00:26:03] a dynamic
[00:26:04] workflow to build this.
[00:26:07] And if anything goes wrong, you know, ask me questions or whatever it is.
[00:26:12] I have a I have a set example from my wife's company.
[00:26:20] So she's analyst and she's supposed to generate the documentation for web
[00:26:26] application.
[00:26:27] So we did it together and it was running as a dynamic workflow for 12 hours,
[00:26:32] then it was
[00:26:33] done.
[00:26:34] And as it was test environment, we instructed Claude to basically test every
[00:26:42] functionality.
[00:26:43] So reverse engineer behavior because she had no access to code base.
[00:26:49] So I told her we can do it even more accurately if she can get access to the
[00:26:54] code base just
[00:26:54] read only.
[00:26:56] And the IT guys were, no, we cannot give you access to code base.
[00:27:00] They just took Claude and generated some kind of MD file extract.
[00:27:06] And they give it that and I was, fuck.
[00:27:10] Why?
[00:27:11] Yeah.
[00:27:12] It's so massive, lots of information.
[00:27:16] Yeah.
[00:27:17] Pointless.
[00:27:18] Yeah.
[00:27:19] Yeah.
[00:27:20] No, it needs, like it needs a lot of information and with gripping, like it can
[00:27:25] do quite well,
[00:27:26] which is kind of what's gotten very interesting in the last couple of months
[00:27:31] for work.
[00:27:31] But this finally gets to what Peter was asking about verify.
[00:27:36] Now I listened to Boris Churney speak about this.
[00:27:42] He said you no longer need to ask Claude to verify its own work.
[00:27:48] You know, I think that's a little bit of marketing propaganda.
[00:27:53] He said that when Opus 5 came out, it verifies its own work in an unbiased
[00:27:58] fashion.
[00:27:59] Sure.
[00:28:00] Sure.
[00:28:01] I agree for the most part, but I will say like a lot of times the amount of bif
[00:28:07] urcations
[00:28:08] that are created when it decides to pick an answer for you, right, which is why
[00:28:13] we do
[00:28:13] bidirectional prompting so we can get extract your information into the agents
[00:28:20] context.
[00:28:21] The thing is like every single question that was left out with an answer and
[00:28:27] there's millions
[00:28:28] of questions.
[00:28:29] So you could never answer all of them causes an assumption, right?
[00:28:33] Claude will have to make an assumption.
[00:28:36] So those assumptions, a lot of times, someone has to kind of verify against the
[00:28:42] North Star.
[00:28:43] And especially like when we're skipping plan, like sometimes plan helps because
[00:28:51] the idea
[00:28:52] is that the agent follows the plan pretty closely, which does hobble the model,
[00:29:00] but it
[00:29:00] also gets you behaviors that are a little bit closer to what you wanted, but it
[00:29:05] 's mostly
[00:29:06] just like it takes too much time and it hobbles the model nowadays.
[00:29:11] So without plan, I think you have to have some sort of verification, whether it
[00:29:17] be you reading
[00:29:18] the agents trace, whether it be spawning another agent to identify all the
[00:29:23] assumptions agent
[00:29:24] to a made as a function of what you figured out.
[00:29:29] To me, like there's no static answer for this that I could be like every single
[00:29:33] time you
[00:29:33] verify exactly like this.
[00:29:36] Of course, like primary deterministic, like 19, like chat, that's those things.
[00:29:41] this can do pretty well if you just have deterministic checks that the agent
[00:29:55] did
[00:29:55] what it said it did verify it goes pretty well so in my experience if it's a
[00:30:02] bigger change I don't know 5,000 lines of color something like this I run
[00:30:08] separate
[00:30:09] verify session and it runs you know it check what was in the handoff or in
[00:30:15] final review whatever yeah run end-to-end tests and I always see it spot
[00:30:25] something and fixes it so for longer run I think verify running afterwards in
[00:30:31] the clean session makes sense but what you mentioned about the feeling the like
[00:30:36] the session recorder how to call it so do you have any like nice way
[00:30:45] to read this history about it implemented like how not going to the
[00:30:55] I don't know crazy Jason thingy or ask it to show moments of thinking through
[00:31:01] the session like how to effectively do that so if I'm in the loop I will scroll
[00:31:09] up right or I'll read it another analogy I've been using for people is like
[00:31:16] slash
[00:31:17] BTW using it all the time is super good like imagine for a second if every time
[00:31:24] you prompt the agent you immediately type slash BTW with summarize very simply
[00:31:31] what you are doing and then you could even have this as a key bind on your
[00:31:36] computer so you prompt the agent you wait five seconds and then you type this
[00:31:43] and now you'll have like a log of a bunch of slash BTW's that very simply
[00:31:49] tell you what the agent is doing and then if at any point anything goes wrong
[00:31:54] you mark that down and you make sure it gets fixed so that's like if I'm in the
[00:31:59] loop I'm doing stuff like this and I'm reading the trace of the agents as well
[00:32:03] skimming so BTW is also recorded in some session looks it actually it
[00:32:12] actually is yeah now a day is like this is a newer thing
[00:32:23] I wonder yeah okay W you okay so you can see you can see I have a bunch of
[00:32:35] different slash BTW's from this session and you can browse that what is
[00:32:42] happening
[00:32:44] here for some reason it's not letting me browse it right now oh it's shit
[00:32:52] okay sorry it's online okay oh it's on this keyboard
[00:32:59] hold on it's there we go okay yeah so on my normal keyboard you can just
[00:33:06] search through your previous slash BTW's right so you can read those and of
[00:33:14] course what that means is that's persistent as an artifact so this is
[00:33:21] really really strong just using BTW all the time when you're in the loop when
[00:33:26] you're out of the loop like you have a Ralph loop either your hook that kind of
[00:33:32] give session summaries or like what I do is I just say read the JSON and like
[00:33:39] say what what's going down and typically as I said with this nested thing every
[00:33:44] Ralph loop has an overseer so it's always looking at what the agents are
[00:33:49] doing right so the I ask the overseer and then if I need to go a little deeper
[00:33:57] it reads the JSON I have a little issue with the with the high could doing a
[00:34:03] summary of the session it would be glossy yeah so I think I don't know if it
[00:34:12] wouldn't be like too much blow to the information but I would want to store
[00:34:18] it all somewhere it's it's stored in the JSON if you want to store it all just
[00:34:24] look in tilde slash dot cloud slash projects it's already in there yeah one
[00:34:31] thing like in general that I think might be useful is store all of your prompts
[00:34:37] and store the models final response like after all of its work was done so
[00:34:44] store those two things because the model typically summarizes what it did and
[00:34:49] keep those as a separate and I would say that could do really well and then if
[00:34:57] you need to escalate to actual JSON then you query the JSON itself Daniel says
[00:35:03] I've been impressed with end-to-end testing inside cloud code for the back end
[00:35:07] code I've worked on making calls to my Kubernetes cluster yeah exactly
[00:35:13] Claude is just so so good at like running end-to-end tests and the cool
[00:35:21] thing about end-to-end tests is that for normal people doing work back in the
[00:35:25] day you know end-to-end tests suck they take sometimes up to hours they can be
[00:35:32] expensive if you don't mock certain things so what we do here is we can just
[00:35:40] ask Claude to end-to-end test the behavior and obviously for UI developers
[00:35:45] or someone who does something visual kind of an end-to-end test that shows
[00:35:50] exactly what's going on visually helps as well and I think there's a lot of
[00:35:56] value in that on the verify side over just verifying like reading code or
[00:36:03] spawning a bunch of agents to nitpick little ideas that they found that should
[00:36:09] be added like I think there's there's more value in end-to-end testing plus
[00:36:14] these deterministic methods but that's my opinion on it I think it it really
[00:36:21] depends on where you are in the complexity matrix I think where I showed
[00:36:32] this last week I don't know if I still no I don't have it it's it'll come up
[00:36:42] later what you showed with this pattern where you can test multiple
[00:36:50] software factories I can in a similar one be used to explore the best possible
[00:37:00] architecture for application itself like yeah it just the question is who
[00:37:08] would propose like for example five different implementations like so David
[00:37:16] inject so so the main orchestrator would inject only like some
[00:37:24] instruction what to build to separate the headless or subagents and those would
[00:37:30] then go on its own without knowing that they should build something else then
[00:37:36] others like I was looking kind of on a ultra code I was kind of curious how
[00:37:46] this crazy bitch works isn't ultra code just forces a dynamic workflow with
[00:37:53] effort max I think so I asked it to like create a diagram how it works and
[00:38:02] basically it's this understand the design implement review but in inside
[00:38:13] each it spawns another workflow where there is a finder for a buck finder for
[00:38:19] security finder for a performance and so on and then there is three times
[00:38:24] skeptic this through this it's just just ask ask it how it works and it's it's
[00:38:31] funny first I was thinking that it would actually do this like explore
[00:38:37] different implementation it I think it's only verifies like the
[00:38:44] itself wait so ultra code is like does it still do that or I can share the
[00:38:58] screen maybe yeah on modern day models that seems potentially like a lot of
[00:39:07] tokens that could be better used for something else yeah well
[00:39:13] that's that's why you can run only like like three per day or
[00:39:22] something can you see my screen with yes agent so here is the
[00:39:33] or your prompt ultra code ah so okay there are like two two months
[00:39:45] so if it's not trivial then you go to orchestrate workflow and there is some
[00:39:56] kind of scout sculpt I think it's giving maybe an example on the bottom of
[00:40:03] inside one workflow like I don't think every workflow would look like that
[00:40:08] maybe
[00:40:09] I'm wrong but like if you're doing a UI and ultra code with UI it's not gonna
[00:40:15] do a per finder necessarily well Claude is describing itself I don't know yeah
[00:40:29] I think it I don't know you never know with a lot of these descriptions but
[00:40:36] yeah
[00:40:36] that I think like the main point of ultra code is just it like tells Claude
[00:40:41] it's okay to spawn on dynamic workflow and spend as much as it wants within
[00:40:46] reason but I'm only six then agents have you guys seen the discourse on the
[00:40:56] person shipping two thousand PR's a day that works at SpaceX there's some weird
[00:41:04] discourse about this basically they took a bunch of grock bot agents and are
[00:41:17] having it do code but like I'd have to presume that a good software factory
[00:41:23] would outperform that by an order of magnitude like a very simple software
[00:41:28] factory also I don't even know like what PR is at the point where you're doing
[00:41:35] that many PR's day on one code base what PR what are you even doing
[00:41:42] maybe it's similar to son or cube so they have this remediation agent which
[00:41:51] is checking I don't know for example you have a Java application yeah and they
[00:41:57] have a 700 rules for developing Java application like how the architecture
[00:42:03] should looks like and what what's basically all the possible best practices
[00:42:09] you can think of if it's like logic is not somehow circled and so it is looking
[00:42:19] for those problems and try to find the whole code base so I can imagine
[00:42:26] something
[00:42:26] like that so it would basically try to self-improve the code right with super
[00:42:33] small steps which would be low blast radius yeah I've been thinking a lot
[00:42:39] about that for Greenfield factories is like how do we make sure that the
[00:42:45] distribution of code you know stays lean and I think actually they talked about
[00:42:52] this a little bit is that if you have so much code being shipped you have to
[00:42:57] have
[00:42:58] some sort of reviewer that asks you know how do we clean up the code how do we
[00:43:03] make sure that the code's distribution is good how do we make sure that the
[00:43:06] comments are lean how do we make sure that there isn't file bloat the test
[00:43:11] suite
[00:43:11] isn't floated there on the other hand there is good test coverage yeah I still
[00:43:21] think the loops are the answer in in general like I think a solid software
[00:43:26] factory with good determinism will outperform absolutely anything and
[00:43:32] there's not really going to be a one-size-fits-all system that can do that so I
[00:43:40] 'm
[00:43:40] probably gonna spend some more time on factories what do you think about this
[00:43:46] article I just sent because if you trying to like the explore the path and find
[00:43:57] the like the right one apparently there are some shortcuts how you can build or
[00:44:13] find the idea of solution without exploring every possible part we all
[00:44:28] have to look at the paper I'll share this paper with with anyone who's who's
[00:44:34] interested I wonder what happens when you do when you use the same model
[00:44:59] because usually when I finish the implementation I worried that I could
[00:45:06] break something else if I do like rapid development so therefore I ask it just
[00:45:11] verify everything run all end-to-end tests I'm wasting a lot of tokens on
[00:45:15] this one of course some some of them are based on scripts so it's not bad but
[00:45:22] but still I am afraid I'd break something else so yeah I think like what I've
[00:45:31] seen
[00:45:31] is that a good testing suite is the most valuable right if you have like
[00:45:38] really really solid testing suite that you're building you know while you're
[00:45:42] moving really fast in your development if something else breaks and the test
[00:45:47] testing suite's coverage is is good then it will be caught by the testing
[00:45:52] suites and so if I develop new feature in that application so I should write
[00:45:59] tests only after the implementation and then run verify in different session
[00:46:05] yeah like yeah like separate session for writing tests and separate session to
[00:46:10] verify maybe I think like a lot of times you can get away nowadays with writing
[00:46:17] tests in the same session and if I'm there with the model or if I want to
[00:46:24] spend same session like if I realize that in that context window it will be
[00:46:30] easy for the agent to write tests and I'm there in the loop with it then I will
[00:46:35] just be like okay write these tests and then I will either skim the tests or
[00:46:40] really I don't skim the actual test I skim the behavior behind the test or
[00:46:45] I'll spawn then another context window to verify against those tests yeah but
[00:46:54] like nowadays with agents they don't write overly biased tests any more
[00:46:58] necessarily unless if you give them a reason to like they're you know opus 5.5
[00:47:04] is pretty good at that but yeah like a solid testing suite that's efficient and
[00:47:12] has extremely high coverage I think is the best way to make sure that your code
[00:47:18] stays in scope and this is once again why the I argue that brown field software
[00:47:28] factories are so easy because it's much easier to have existing tests and then
[00:47:32] fill in issues in the existing tests rather than create new features new
[00:47:37] work create this scaffolding yourself and build up
[00:47:42] but yeah that's that's I'll have to actually read this paper because this
[00:47:50] LinkedIn post doesn't doesn't give a very thorough kind of read up so I have it
[00:47:56] on my to-do list also the top top comment in the discussion below they also
[00:48:08] mentioned that it kind of for some people it works I don't know so can you
[00:48:13] share the X-coli value draw for us yeah the yeah this nested I think like this
[00:48:26] is you know people are always asking like how do we you know how do we do
[00:48:35] work that doesn't just bloat go here you know how do we spend
[00:48:43] a lot of tokens without producing slop and I think the answer is in workflows
[00:48:50] like this so you define a very clear well-defined workflow that gets a lot
[00:48:55] of productivity but will still run four days on end and I think that you can
[00:49:01] capture units of intelligence effectively by doing setups like this and
[00:49:08] getting really good at patterns like this nested pattern specifically it's
[00:49:19] funny how like Ralph looks were not that favorite with older models but right
[00:49:26] now because models are better alphabes are like big on the horse I guess I don
[00:49:34] 't
[00:49:34] know I think like I think Ralph Loops have always been like relatively good
[00:49:42] there was a period with opus 4.8 with when dynamic workflows first got
[00:49:46] released that it was like why use Ralph Loops but yeah I I think that's the
[00:49:55] Ralph Loops always have been an optimal pattern because they're like
[00:49:58] extremely simple like even dynamic workflows open the door for a lot of
[00:50:03] complexity and like non-observability and everything like that but Ralph Loops
[00:50:08] are as observable as you want them to be and as autonomous as you want them to
[00:50:13] be so that that's my opinion on on Ralph Loops I think the main issue with
[00:50:21] Ralph Loops is that people don't have their own skills for Ralph Loops and they
[00:50:27] don't have an understanding of what Ralph Loops are doing so then they just
[00:50:31] kind of like they mess it up like if you don't have an understanding of context
[00:50:37] windows then you won't be able to effectively use Ralph Loops. Okay what
[00:50:44] else it's been an hour I think okay I'll real quick just lecture on an update
[00:50:50] on
[00:50:52] my proactive systems so currently this is kind of how my proactive systems work
[00:51:02] and I'll open up like one of these for example so each thing I do in my day to
[00:51:08] day has two markdown files we have a immutable file which is the north star
[00:51:15] which just focuses on like very quickly saying you know what is the north star
[00:51:20] what it is what don't looks like and pretty lean file and this makes it easy
[00:51:27] for me to just inject this file into Claude and then start work so if I go
[00:51:33] here and start a new Claude session and I just inject it with the at symbol
[00:51:46] I can immediately have a conversation about this thing and same thing with the
[00:51:53] now dot MD so I can inject both and then I can immediately say like what's
[00:52:00] next you know let's let's let's figure out what's next and these obviously what
[00:52:08] I would suggest is you set it up yourself according to how you would say
[00:52:13] it and then on the current now dot MD it basically updates using hooks so if I
[00:52:23] have kind of mentioned it before you have some hooks which identify every
[00:52:34] time your Claude session ends so if I have a Claude session I have a session
[00:52:40] end hook which will run after the session ends and it will then ask a haiku
[00:52:46] agent
[00:52:47] or Jev it will say which lane was this session in right and then the session
[00:53:00] will route to a lane where as you saw I have a bunch of different fronts in my
[00:53:05] work and anyone who says that they don't have like a couple of different
[00:53:09] things they do every day is just lying
[00:53:11] Everyone has like a specific capped amount of things
[00:53:15] that they do in their day to day.
[00:53:17] That can be broken into categories.
[00:53:19] So for me, like to give you inspiration,
[00:53:22] I have a done for you data engineering project
[00:53:24] for a large company.
[00:53:26] I'm building a software factory and applying for venture.
[00:53:29] I have my YouTube videos.
[00:53:31] I have an enterprise training strategy,
[00:53:35] pipeline for a client, potential partnership.
[00:53:38] So I have all these things
[00:53:39] and they all represent their own markdown file.
[00:53:42] And so we have these markdown files.
[00:53:46] We have the north star dot and D,
[00:53:49] which is like the ground truth.
[00:53:51] This is like never going to change for the most part.
[00:53:54] And the models aren't to change this
[00:53:58] because this is like what I have to say about the problem.
[00:54:00] You kind of hand write these.
[00:54:02] I'm going to go back, I've been changing the system today.
[00:54:05] So I'm going to go back and rehand write these.
[00:54:09] And then you have a movable, right?
[00:54:11] So each one has a,
[00:54:14] said North start ridiculous.
[00:54:16] And then you're going to have a movable.
[00:54:18] So this is the now dot and V.
[00:54:22] So this is dynamic, right?
[00:54:24] And so basically, we first have a,
[00:54:31] a cloud session ends and I have a hook for me,
[00:54:36] which summarize the session and put it in plot memory.
[00:54:41] And then I'm going to have which lane the session was in.
[00:54:47] And it's going to route,
[00:54:51] you guys saw the different fronts that I have in my work.
[00:54:54] So it chooses which one it was in, you know, typically it's one,
[00:54:58] but sometimes it can be two.
[00:55:00] And then based on this,
[00:55:02] it will then spawn another cloud dash P.
[00:55:06] And it will effectively say what,
[00:55:11] it will inject the session summary from down here
[00:55:16] based on what work I just did.
[00:55:20] It will inject to the northstar.md.
[00:55:23] It will inject the now dot and V.
[00:55:29] So it injects the previous session I just finished.
[00:55:33] It injects my ground truth and where we are now.
[00:55:36] And it basically says what's next for Roman
[00:55:41] and what could an autonomous agent be?
[00:55:46] So it asks those two questions.
[00:55:49] I don't remember if this is in two context windows,
[00:55:52] like a.k.a. this would be another cloud dash P
[00:55:56] with all the same info.
[00:55:57] I don't think it matters too much.
[00:55:59] But basically you have this.
[00:56:03] It will run this.
[00:56:04] And then you have another agent,
[00:56:07] which is given everything.
[00:56:09] And it of course says instead of this,
[00:56:14] it says updates now dot minimum.
[00:56:18] Right.
[00:56:21] So this allows persistent understanding
[00:56:24] of where we are in our fronts
[00:56:28] and also gives us nice suggestions
[00:56:31] on what we should do next.
[00:56:33] So you guys can see for me just to give you some examples.
[00:56:37] It also I have like yesterday.
[00:56:42] This is kind of cool because I have its own flow
[00:56:45] where I can see what I did yesterday, which is kind of fun.
[00:56:48] And then it suggests every day
[00:56:54] what the main thing I should do next is.
[00:56:58] But in general, I'll skip that one
[00:57:01] because I don't want to talk about that
[00:57:03] because there's an NDAs and stuff.
[00:57:05] But for my software factory,
[00:57:08] you know, get a clear start date for a small trial.
[00:57:13] What an autonomous agent could do
[00:57:16] is draft the application preview.
[00:57:18] So like, and then I can review the exact prompt
[00:57:22] and click accept.
[00:57:23] And it goes through my needs review and my command sound.
[00:57:27] So I'll just click accept for the fun of it.
[00:57:30] That reverse maps into my tasks.
[00:57:32] You can see there's pending and we're here.
[00:57:34] Right.
[00:57:37] Questions about this system thus far?
[00:57:40] - What's the hook for ending a session?
[00:57:47] Like it's not every prompt, right?
[00:57:49] But it's it's called a session end hook.
[00:57:54] I believe session end hooks trigger.
[00:57:59] I mean, I can look when you should look into when they trigger,
[00:58:03] but I believe it's 15 minutes AFK or no,
[00:58:08] I think it used to be 15 minutes AFK,
[00:58:10] but now it's just slash clear session
[00:58:13] or closed a session.
[00:58:16] And so when that happens, it will run the hook.
[00:58:21] Does that answer your question?
[00:58:26] - Yep.
[00:58:27] - Yeah. - Cool.
[00:58:28] - Yeah.
[00:58:29] So it's two session end hooks, right?
[00:58:33] So we have our cloud session.
[00:58:35] Cloud session ends one hook for this, one hook for this.
[00:58:39] And then these hooks, what runs these are right after.
[00:58:44] I think it's within this hook.
[00:58:48] So like, as you know, a hook is a bash script.
[00:58:50] So I'll just say batch.sh.
[00:58:55] And then it will spawn, it will be,
[00:58:59] say something like cloud.shp.
[00:59:01] What session was this in?
[00:59:03] And then it will take the output of this cloud.shp,
[00:59:09] I think just via schema checking.
[00:59:12] And then it will inject this cloud.shp.
[00:59:15] And then use the schema found previous
[00:59:24] as a dynamic injection and say this and this.
[00:59:29] So it's three cloud.shp's.
[00:59:33] It doesn't actually, like the reason I don't know this
[00:59:35] is 'cause like the details behind how this second hook
[00:59:39] is triggered doesn't really matter too much
[00:59:41] for internal systems.
[00:59:43] It just runs whenever this finishes.
[00:59:48] And how it does that, I don't really care.
[00:59:53] Cool.
[00:59:54] Okay, questions on.
[01:00:00] So I think one thing for you guys that would be cool
[01:00:04] is if we could actionably set something up like this
[01:00:08] for each of you.
[01:00:10] So maybe what I can do is on Friday's session,
[01:00:16] if you guys are here, I can do a little call on,
[01:00:23] like basically getting you guys the code
[01:00:25] for something like this
[01:00:27] and walking you through how to set this up in your own work.
[01:00:31] Yeah.
[01:00:34] - I would love this.
[01:00:36] Can I share my screen for a second?
[01:00:40] - Yeah, of course.
[01:00:41] - Funny thing is like it kind of follows
[01:00:46] some of the things that I can clear.
[01:00:51] This is kind of funny 'cause like it's kind of similar.
[01:01:22] With this North Star and kind of how I organize my work
[01:01:26] and I've been trying to figure out how to better automate
[01:01:28] a lot of this.
[01:01:29] One of it is like physical things
[01:01:33] that I have to do outside of clubs,
[01:01:35] but yeah, I think this would be super helpful
[01:01:37] for how I do a lot of business
[01:01:42] that I need to understand.
[01:01:44] I'm pretty bad at it.
[01:01:45] That in general, it's like prioritizing
[01:01:49] and like organizing my life.
[01:01:51] So I think this would be super helpful for me.
[01:01:54] - 100%.
[01:01:55] Yeah, I think for you,
[01:01:58] having maybe a little more granularity
[01:02:04] in the different things you do,
[01:02:06] like having more than just two fronts.
[01:02:08] Like for example, if you have one project at work
[01:02:12] versus your tickets at work
[01:02:15] and your tickets at work
[01:02:16] could be an autonomous system that is like,
[01:02:20] okay, we've detected a new ticket
[01:02:22] and now we're taking the plan or doing the ticket.
[01:02:27] And so like each one requires its own automations
[01:02:32] and I think that's what's cool about this.
[01:02:34] - Yeah, no, definitely.
[01:02:39] I have set that up on running the two tickets.
[01:02:43] I need to start comparing my normal work against it.
[01:02:47] But yeah, it's been,
[01:02:49] I haven't quite started actually committing those pages yet
[01:02:56] but yeah, you have to like kind of compare
[01:02:59] and like make sure that I'm comfortable with it at this point.
[01:03:03] - Cool.
[01:03:03] You could have another thing
[01:03:05] that basically part of the automation
[01:03:08] that looks over the trace of what the previous agent did
[01:03:12] and just very clearly outlines
[01:03:14] like every decision it made
[01:03:15] and why it did what it did
[01:03:17] so that your reviews aren't heinous.
[01:03:19] Let's see.
[01:03:25] There was one more thing that I forgot to mention
[01:03:28] that I've updated here.
[01:03:31] And basically in this architecture, the other thing,
[01:03:35] it does is it says,
[01:03:38] if it isn't obvious
[01:03:42] or there are blockers
[01:03:45] that Roman can answer,
[01:03:48] ask Roman.
[01:03:51] And I believe it also first says,
[01:03:56] spawn a subagent to research
[01:04:00] cloud accessible slash,
[01:04:05] cloud memory, which is my these session summaries.
[01:04:10] To get a feeling of the work we've done.
[01:04:19] So that's like another example.
[01:04:21] I think that's closer to what the prompt actually is.
[01:04:27] If it isn't obvious or there are blockers
[01:04:29] that Roman can answer, ask Roman instead
[01:04:32] of suggesting work.
[01:04:35] And the reason we do that is because a lot of times
[01:04:38] I realized that the work it was suggesting was like,
[01:04:41] it clearly had no idea where I actually was.
[01:04:44] And so it was just instead of asking me questions,
[01:04:47] it was asking me nonsense.
[01:04:49] So these open questions ideally would appear
[01:04:53] kind of in my needs review stuff like that.
[01:04:55] So you can actually see,
[01:04:57] oh, it's asking me a bunch of questions.
[01:05:01] So now my needs review, I'm gonna have to tune this,
[01:05:04] but it's like, oh, no, these aren't questions.
[01:05:07] These are actual tasks that I could say go ahead and do.
[01:05:12] So for example, I'm doing enterprise training.
[01:05:14] It would build this so I could approve
[01:05:20] and of course add notes, which is kind of cool.
[01:05:23] And then it'll run autonomously.
[01:05:25] For my videos, yeah, that'd actually be kind of cool.
[01:05:34] I'm gonna say approve.
[01:05:35] And then when you click approve, it goes through here.
[01:05:40] So once again, I'm kind of getting back
[01:05:42] to spending the majority of my time ideally
[01:05:44] in needs review and reading over these fronts
[01:05:49] and doing in the loop work for more thorough tasks.
[01:05:53] And then if it ever has questions for me,
[01:05:56] I just dictate the answer to those.
[01:05:58] Keep the system up to date
[01:05:59] so that it's suggesting good work consistently.
[01:06:04] So it's not only an organizational tool,
[01:06:06] but it's also a autonomous tool.
[01:06:09] And then as an extension of that,
[01:06:11] I have a nightly thing that runs that checks
[01:06:15] how much usage I have left and how long till reset.
[01:06:20] And if I have under 36 hours and over 60% usage left,
[01:06:25] it just does, it picks up these tasks automatically
[01:06:28] and just does them and to end in its own sandbox.
[01:06:32] You can see it does work trees.
[01:06:34] - How do you have it?
[01:06:37] How do you have a check usage?
[01:06:40] Because I had trouble getting my clog
[01:06:45] to check those percentages.
[01:06:48] - I'll ask for you to double check,
[01:06:51] but I believe it's in the status line.
[01:06:53] - Well, you can read the status line.
[01:07:00] - Yeah, the status line is where a lot of good data comes from
[01:07:05] and it can check from the status line, a lot of this data,
[01:07:09] but I'll just make sure that,
[01:07:11] 'cause I built this like a couple of weeks ago,
[01:07:14] so I could have forgotten what we actually decided on.
[01:07:18] But I remember it is accessible,
[01:07:23] like the data, where are we?
[01:07:25] - I was fighting my clog over it,
[01:07:27] like a couple of days ago. - You were fighting our clog?
[01:07:30] That's hilarious.
[01:07:31] - Oh, yeah, I've seen the same thing where, like,
[01:07:33] Claude will say, like, I don't have access to that.
[01:07:36] You have to go check the website.
[01:07:39] - I need like a administrator token.
[01:07:42] I was like, I gave you all access.
[01:07:44] (laughing)
[01:07:46] I don't know what you want.
[01:07:46] - No, it's status line, at least.
[01:07:50] Reading is only as fresh as the last time
[01:07:53] in the clog code session drew its status line,
[01:07:55] so, and in codecs, I think it was,
[01:07:59] I remember struggling with this, actually.
[01:08:01] Okay, yeah, so basically in codecs,
[01:08:09] there's just some sort of variable event,
[01:08:13] and in clog code, there is status line.
[01:08:17] - Great.
[01:08:19] - Thanks.
[01:08:20] - Yeah, you bet.
[01:08:23] And yeah, so if you want to take a screenshot,
[01:08:26] you could probably just inject this.
[01:08:28] But yeah, I mean, it's kind of a cool idea
[01:08:35] because it's fully a self-licking ice cream cone,
[01:08:38] which means, like, all I have to do is just do my normal work,
[01:08:42] and sometimes answer some questions,
[01:08:45] and not only do I get kind of really tailored,
[01:08:48] nice suggestions, which, by the way, FYI,
[01:08:52] you're never gonna get a one-size-fits-all system
[01:08:54] that can do this.
[01:08:56] Like, that's literally impossible.
[01:08:58] You have to have a system that you built yourself
[01:09:01] that's tailored to your needs and what good looks like.
[01:09:04] It's never gonna just kind of spawn that in for you.
[01:09:08] And then, of course, like, instead of me running out of usage,
[01:09:14] it just does the work for me, in those cases,
[01:09:18] where it identifies that.
[01:09:20] So, I'll get you guys the templates to this,
[01:09:24] or at least the specs to this in the command center,
[01:09:28] just as a little gift, once I have this finished.
[01:09:33] And once I've used it for a couple of days,
[01:09:35] 'cause I think it's important that it actually becomes,
[01:09:39] or is something that I use consistently for a long time,
[01:09:43] like I did the command center and like I do the command center
[01:09:46] for then me to give it to you.
[01:09:48] But if you wanna build this on your own now,
[01:09:51] just take this lecture and you can probably give the lecture
[01:09:53] to Claude and he'll understand.
[01:09:56] Questions, thoughts, anything else you wanna see?
[01:10:04] - How do I give a lecture to Claude, like this?
[01:10:08] And I can link to, you send the links to the videos,
[01:10:13] but I don't know how to pass that to Claude.
[01:10:17] But pro tip, all you gotta do is go,
[01:10:20] let me show you here, you're gonna click,
[01:10:24] let's say, this recording, after this, boom,
[01:10:29] open up Claude, you're gonna say, extract this video
[01:10:36] as MP4 on my computer and use, you know,
[01:10:42] for you, you might have an external dictation tool,
[01:10:45] or transcription tool, or your own,
[01:10:47] for me, I have slash dictation tool to grab the transcript.
[01:10:52] And it works like that.
[01:10:57] It's almost like magic nowadays.
[01:10:59] I remember this didn't used to work,
[01:11:00] but it works extremely well now.
[01:11:02] So yeah, just give it this,
[01:11:07] tell it to use browser, control, and it'll work.
[01:11:13] So it pretty much can do that for any instance.
[01:11:16] - Pretty much, yeah, any video whatsoever.
[01:11:21] Claude has figured out a way to find it
[01:11:25] in the exposed user interface stuff,
[01:11:29] because it just goes through your browser.
[01:11:31] And another pro tip is that Claude in Chrome
[01:11:34] is logged into your browser.
[01:11:36] So sometimes if you use an unlocked in playwright,
[01:11:39] this wouldn't work.
[01:11:40] But Claude in Chrome is the same as a user,
[01:11:42] so it is exposed the same stuff a user can see.
[01:11:45] Which also means you can do automations
[01:11:51] that won't get you banned.
[01:11:53] Like my LinkedIn automation,
[01:11:55] I run 24/7.
[01:11:58] Right.
[01:12:00] So you can see it's always posting various posts.
[01:12:11] - I'm actually reading those.
[01:12:13] - I'm actually reading those and some of them are really good.
[01:12:17] - Yeah, they're good, right?
[01:12:19] - Yeah. (laughs)
[01:12:20] - It's funny.
[01:12:22] - Yeah, I mean, if you have a good enough pipeline,
[01:12:24] like there are some that I delete manually
[01:12:27] 'cause I see them and I'm like,
[01:12:28] holy this missed the mark.
[01:12:30] But in general, like maybe I'll show them again.
[01:12:34] It's, 'cause it takes, the thing is like,
[01:12:38] if it takes real inspiration, then it has real work
[01:12:41] it can look from.
[01:12:42] So I was reading this one today.
[01:12:44] I have Claude, I might build in like a better hook system
[01:12:48] to like actually give more entertaining hooks,
[01:12:51] but I've got code build five interfaces, ideas at once,
[01:12:54] then I pick the one I wanna keep.
[01:12:56] Launch subagents, they build the alternatives.
[01:13:00] I use this for interfaces and animations.
[01:13:03] I believe it grabbed this from one of our cohort calls.
[01:13:08] So just grab the way I talk about a topic.
[01:13:10] It has a system to recreate my voice
[01:13:12] and then it has a, obviously like a skill
[01:13:15] or a pipeline to build the visuals and obviously templates.
[01:13:20] But is there anything else?
[01:13:29] Any other questions on this or any other thoughts
[01:13:32] on kind of how to get an autonomous system like this
[01:13:35] that's proactive?
[01:13:39] It all makes sense.
[01:13:41] I still have some gaps.
[01:13:43] The biggest gap I have is like conceptually I get
[01:13:47] going into command center and setting up pipelines,
[01:13:50] running them, et cetera.
[01:13:51] I'm starting to play with creating like extensions
[01:13:54] of the dashboard, but I'm getting kind of hung up
[01:13:58] when you wanna do more advanced things.
[01:14:01] Like I think you've called it like a mini SAS kind of thing.
[01:14:05] - I like your sauce, yeah.
[01:14:07] - Yeah, micro SAS.
[01:14:08] Yeah, yeah, I'm still just trying to figure out conceptually
[01:14:16] like when I have an idea how I spend my time
[01:14:21] between the CLI and command center,
[01:14:24] getting everything kind of orchestrated
[01:14:26] to where then it's in the right repo
[01:14:31] and I get that like you, I think you run more
[01:14:33] like a mono repo thing and maybe I need to go to that
[01:14:37] because I think part of my challenge is I've got
[01:14:39] too many repos and I'm not going on tangents, sorry.
[01:14:44] Yes, I've got fronts that I'm thinking about now.
[01:14:49] I haven't implemented yet and so I'm excited for Friday.
[01:14:54] You know, maybe I'll leave it there.
[01:14:56] I just need to see more examples of like
[01:14:59] and things will click I think.
[01:15:02] - Yes, so in general, like for this stuff,
[01:15:06] like for example, how I built this market research pipeline
[01:15:11] is I basically said, I went, I'll scare this,
[01:15:16] I went into the command center and of course
[01:15:18] I have spec maps for it.
[01:15:20] So I just say, boom, here's the read me.
[01:15:23] And I say, I would like to build a new feature
[01:15:28] in the command center called market research period.
[01:15:33] It should have its own page on the dashboard.
[01:15:40] Here's the flow I want.
[01:15:45] We have a cron job installed at 6 a.m.
[01:15:52] that strikes the most viral videos
[01:15:57] according to the dot.
[01:16:00] And then I'd like to give it inspiration.
[01:16:03] So I can say, look at my cron tab
[01:16:06] for how I have to set up.
[01:16:09] This is very important 'cause I've seen this happen
[01:16:13] before where there are issues and you just root that out.
[01:16:16] Then you say something like blah, blah, blah, blah, blah.
[01:16:19] And then I'll say implemented via a dynamic workflow.
[01:16:25] And then I will see what it puts out and I will tune it.
[01:16:30] - Got it.
[01:16:31] That was helpful, thank you.
[01:16:32] - Very simple.
[01:16:33] Yeah, for internal tools, like obviously for external tools
[01:16:36] it's different, which is why I have all the things I teach.
[01:16:39] But for internal tools like that specifically,
[01:16:42] it's really as simple as move as fast as possible
[01:16:46] and like be very descriptive of the high level idea
[01:16:50] you want and make sure that cloud is not
[01:16:54] bloating the idea.
[01:16:56] Like for example, if I wanted to make a cloud skill
[01:17:00] that I use, I would very clearly ask for the skill
[01:17:04] and then I would very clearly make sure
[01:17:06] that it builds the skill in a way that's not adding
[01:17:09] a bunch of other instructions.
[01:17:11] - Yeah.
[01:17:13] - And that's nowadays the main thing to navigate
[01:17:16] is like over engineering 'cause it does that.
[01:17:21] But yeah, I mean, I can look at any of these.
[01:17:25] And for me, this is all I needed.
[01:17:27] And sometimes there are little issues.
[01:17:31] I think maybe they removed my Reddit access.
[01:17:36] Or maybe not, odd to look.
[01:17:38] I'm also considering like a global slash goal agent
[01:17:44] that's running 24/7 or a global route loop
[01:17:49] with a slash goal.
[01:17:50] That's just looking for little issues like this
[01:17:53] in my command center and patching them minimally.
[01:17:56] Like I think you could do that and it wouldn't be hard.
[01:18:00] So it would just grep or rejects the word failed.
[01:18:07] And then it would expand around that.
[01:18:09] And then it would be, oh look, Reddit pipeline failed.
[01:18:12] Here's why.
[01:18:12] And then it would put in my needs review
[01:18:14] like an overview of why that happened.
[01:18:20] No reason you couldn't.
[01:18:21] Let's see what this came up with.
[01:18:24] Yeah, that's what this built.
[01:18:31] Okay, so I think I am going to jump off
[01:18:39] so that I can have more time to prepare
[01:18:45] for Friday's lecture where I will have something
[01:18:50] like this for each one of you, your homework,
[01:18:53] each one of you, hopefully you can make it
[01:18:55] to the call on Friday, otherwise DM me.
[01:18:57] But your homework is to build these files.
[01:19:02] And so just to make it very, very clear what you need to do
[01:19:06] and you can give this transcript to cloud once again,
[01:19:09] is open up two files.
[01:19:13] The first, you're going to write manually,
[01:19:16] which is basically your north star of what the thing
[01:19:19] actually is, right?
[01:19:21] What it is, kind of the north star behind what you want.
[01:19:25] If you have any examples of what good looks like
[01:19:28] on your computer, so oops, I clicked the wrong thing.
[01:19:31] So for my videos, I have like three reference decks
[01:19:35] that I really like, right?
[01:19:38] And these three reference decks serve
[01:19:41] as few shot inspiration.
[01:19:42] And you can see how this is different
[01:19:44] from maybe like my business strategy front
[01:19:47] or something else.
[01:19:48] So then you're going to have it also create,
[01:19:53] or you guys won't have it create this yet.
[01:19:58] I'll have it do an automation in your systems
[01:20:01] to create that.
[01:20:02] Yeah, and the other thing is just identifying
[01:20:08] like what possible tasks it could do
[01:20:12] sometimes can be valuable.
[01:20:14] And because, for example,
[01:20:17] my pipeline for a production level application
[01:20:22] like this software engineer pipeline,
[01:20:25] what work it does will be different from my videos, right?
[01:20:30] My videos, I have a once a week video I would like.
[01:20:34] And so that's very different from,
[01:20:37] you know, what's next in my code base.
[01:20:39] Or again, as an example for Daniel,
[01:20:42] Daniel's full time job part of it
[01:20:44] is taking tickets and doing the tickets.
[01:20:46] So building his own autonomous system to do those tickets
[01:20:49] instead of just reusing this template
[01:20:52] may be better for that.
[01:20:55] And then he just gets an alert
[01:20:57] if the ticket is wrong,
[01:20:59] or like if something went wrong in the ticket.
[01:21:04] So yeah, actionable step, make,
[01:21:08] split down your day-to-day,
[01:21:10] everything you do in your day-to-day
[01:21:12] that you want tracked into these pipelines.
[01:21:16] And then write these manually.
[01:21:19] And then come to the call Friday.
[01:21:23] Cool, any closing questions?
[01:21:35] - No, thank you so much.
[01:21:37] - All right, guys.
[01:21:38] - Take care.
[01:21:39] - Thank you everyone.
[01:21:40] Have a good rest of your day.
[01:21:42] - Thanks for having us.
[01:21:43] - Bye.
