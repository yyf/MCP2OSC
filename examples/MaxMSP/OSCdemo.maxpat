{
	"patcher" : 	{
		"fileversion" : 1,
		"appversion" : 		{
			"major" : 8,
			"minor" : 6,
			"revision" : 0,
			"architecture" : "x64",
			"modernui" : 1
		}
,
		"classnamespace" : "box",
		"rect" : [ 80.0, 80.0, 480.0, 320.0 ],
		"boxes" : [ 			{
				"box" : 				{
					"id" : "obj-title",
					"maxclass" : "comment",
					"numinlets" : 1,
					"numoutlets" : 0,
					"patching_rect" : [ 20.0, 12.0, 360.0, 20.0 ],
					"text" : "MCP2OSC demo — slider / button / preset (UDP 9500)"
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-udp",
					"maxclass" : "newobj",
					"numinlets" : 1,
					"numoutlets" : 1,
					"outlettype" : [ "" ],
					"patching_rect" : [ 20.0, 44.0, 91.0, 22.0 ],
					"text" : "udpreceive 9500"
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-route",
					"maxclass" : "newobj",
					"numinlets" : 1,
					"numoutlets" : 4,
					"outlettype" : [ "", "", "", "" ],
					"patching_rect" : [ 20.0, 76.0, 320.0, 22.0 ],
					"text" : "OSC-route /mcp2osc/demo/slider /mcp2osc/demo/button /mcp2osc/demo/preset"
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-us",
					"maxclass" : "newobj",
					"numinlets" : 1,
					"numoutlets" : 2,
					"outlettype" : [ "", "" ],
					"patching_rect" : [ 20.0, 112.0, 52.0, 22.0 ],
					"text" : "unpack f"
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-ub",
					"maxclass" : "newobj",
					"numinlets" : 1,
					"numoutlets" : 2,
					"outlettype" : [ "", "" ],
					"patching_rect" : [ 140.0, 112.0, 48.0, 22.0 ],
					"text" : "unpack i"
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-up",
					"maxclass" : "newobj",
					"numinlets" : 1,
					"numoutlets" : 2,
					"outlettype" : [ "", "" ],
					"patching_rect" : [ 280.0, 112.0, 48.0, 22.0 ],
					"text" : "unpack i"
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-slider",
					"maxclass" : "flonum",
					"numinlets" : 1,
					"numoutlets" : 2,
					"outlettype" : [ "", "bang" ],
					"parameter_enable" : 0,
					"patching_rect" : [ 20.0, 148.0, 60.0, 22.0 ]
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-button",
					"maxclass" : "toggle",
					"numinlets" : 1,
					"numoutlets" : 1,
					"outlettype" : [ "int" ],
					"parameter_enable" : 0,
					"patching_rect" : [ 140.0, 148.0, 24.0, 24.0 ]
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-sel",
					"maxclass" : "newobj",
					"numinlets" : 4,
					"numoutlets" : 4,
					"outlettype" : [ "bang", "bang", "bang", "" ],
					"patching_rect" : [ 280.0, 148.0, 68.0, 22.0 ],
					"text" : "sel 1 2 3"
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-p1",
					"maxclass" : "message",
					"numinlets" : 2,
					"numoutlets" : 1,
					"outlettype" : [ "" ],
					"patching_rect" : [ 280.0, 184.0, 70.0, 22.0 ],
					"text" : "0.25, 0"
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-p2",
					"maxclass" : "message",
					"numinlets" : 2,
					"numoutlets" : 1,
					"outlettype" : [ "" ],
					"patching_rect" : [ 280.0, 212.0, 62.0, 22.0 ],
					"text" : "0.5, 1"
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-p3",
					"maxclass" : "message",
					"numinlets" : 2,
					"numoutlets" : 1,
					"outlettype" : [ "" ],
					"patching_rect" : [ 280.0, 240.0, 62.0, 22.0 ],
					"text" : "1., 1"
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-unp",
					"maxclass" : "newobj",
					"numinlets" : 1,
					"numoutlets" : 2,
					"outlettype" : [ "", "" ],
					"patching_rect" : [ 200.0, 272.0, 69.0, 22.0 ],
					"text" : "unpack f i"
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-c1",
					"maxclass" : "comment",
					"numinlets" : 1,
					"numoutlets" : 0,
					"patching_rect" : [ 20.0, 180.0, 90.0, 20.0 ],
					"text" : "slider 0-1"
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-c2",
					"maxclass" : "comment",
					"numinlets" : 1,
					"numoutlets" : 0,
					"patching_rect" : [ 140.0, 180.0, 90.0, 20.0 ],
					"text" : "button toggle"
				}

			}
, 			{
				"box" : 				{
					"id" : "obj-c3",
					"maxclass" : "comment",
					"numinlets" : 1,
					"numoutlets" : 0,
					"patching_rect" : [ 360.0, 148.0, 100.0, 20.0 ],
					"text" : "preset 1|2|3"
				}

			}
 ],
		"lines" : [ 			{
				"patchline" : 				{
					"destination" : [ "obj-route", 0 ],
					"source" : [ "obj-udp", 0 ]
				}

			}
, 			{
				"patchline" : 				{
					"destination" : [ "obj-us", 0 ],
					"source" : [ "obj-route", 0 ]
				}

			}
, 			{
				"patchline" : 				{
					"destination" : [ "obj-ub", 0 ],
					"source" : [ "obj-route", 1 ]
				}

			}
, 			{
				"patchline" : 				{
					"destination" : [ "obj-up", 0 ],
					"source" : [ "obj-route", 2 ]
				}

			}
, 			{
				"patchline" : 				{
					"destination" : [ "obj-slider", 0 ],
					"source" : [ "obj-us", 0 ]
				}

			}
, 			{
				"patchline" : 				{
					"destination" : [ "obj-button", 0 ],
					"source" : [ "obj-ub", 0 ]
				}

			}
, 			{
				"patchline" : 				{
					"destination" : [ "obj-sel", 0 ],
					"source" : [ "obj-up", 0 ]
				}

			}
, 			{
				"patchline" : 				{
					"destination" : [ "obj-p1", 0 ],
					"source" : [ "obj-sel", 0 ]
				}

			}
, 			{
				"patchline" : 				{
					"destination" : [ "obj-p2", 0 ],
					"source" : [ "obj-sel", 1 ]
				}

			}
, 			{
				"patchline" : 				{
					"destination" : [ "obj-p3", 0 ],
					"source" : [ "obj-sel", 2 ]
				}

			}
, 			{
				"patchline" : 				{
					"destination" : [ "obj-unp", 0 ],
					"source" : [ "obj-p1", 0 ]
				}

			}
, 			{
				"patchline" : 				{
					"destination" : [ "obj-unp", 0 ],
					"source" : [ "obj-p2", 0 ]
				}

			}
, 			{
				"patchline" : 				{
					"destination" : [ "obj-unp", 0 ],
					"source" : [ "obj-p3", 0 ]
				}

			}
, 			{
				"patchline" : 				{
					"destination" : [ "obj-slider", 0 ],
					"source" : [ "obj-unp", 0 ]
				}

			}
, 			{
				"patchline" : 				{
					"destination" : [ "obj-button", 0 ],
					"source" : [ "obj-unp", 1 ]
				}

			}
 ]
	}

}
