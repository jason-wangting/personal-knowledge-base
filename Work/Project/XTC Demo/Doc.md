Hello everyone, Good afternoon, welcome to our booth,  today, I'd like to introduce our multi-agent system MioVerse for generating workflows and 3D scenes using natural language.

1. Traditionally, process engineers write SOPs (standard operating procedures) first. 
Then other engineers have to read these SOPs carefully and turn them into workflows. 

2. This is a workflow example, which is built in the Workflow Canvas. 
Workflow Canvas is an industrial Edge app belongs to DI FA HMI. 
Developers can drag and drop function blocks to create the workflow to describe the production line. 

3. This is not easy enough and takes a little effort. 

4. Now, with large language models, we can make this much simpler. 

5. Users just need to provide the SOPs, and the model will generate workflows automatically. 

6. In other words, the large model generates workflows directly from SOPs, so engineers don’t need to do this work.  
  
7. However, large models can sometimes make mistakes. So it is risky to use these workflows directly in real production. 

8. To solve this problem, we also create a 3D scene based on the SOP. 

9. We run the workflow in this 3D scene first to check and make sure it is correct. 

10. Only after it passes the test then we can deploy it to the real world.

11. The system has four main agents. 

12. Supervisor agent decides which agent to call based on the user's request. Workflow Build agent and Scene Build agent are used to generate the workflow and 3d scene. the last one is run workflow agent. It will run the workflow in the workflow runtime and trigger the 3D scene change. additionally, the run workflow agent also monitor the running of workflow. 

13. If error happens, it will trigger workflow build agent to modify the workflow. so It's a loop. MioVerse generate the test 3d scene and the workflow according to the user's request. 

14. Run workflow agent execute the workflow in the runtime. if something is wrong when the workflow is running, The system will call related agent again to modify the workflow and the scene. 

15. it's a loop, Agent take over everything here, 
only two things that developer needs to do，one is providing the sop，the other one is confirmation. 

16. Users can also describe their requirements here to modify the 3D scene and workflow using natural language.